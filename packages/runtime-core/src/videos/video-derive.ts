import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RpcError,
  type DocumentRecord,
  type EditOperation,
  type Id,
  type TransactionReceipt,
  type VideoCreated,
  type VideoDeriveParams,
  type VideoDeriveResult,
  type VideoOpenResult,
  type VideoSnapshot,
} from '@baocut/protocol';
import { CAPTION_DOCUMENT_REF, PipelineStepError, existingCaptionLayer, planCaptionLayer, type CaptionSource } from '@baocut/jobs';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import type { TrustedPrincipal } from '../gateway.ts';
import {
  DERIVATION_KIND,
  DeriveError,
  alignCrops,
  alignRange,
  assetFileKey,
  clockLabel,
  cuesInRange,
  derivationKey,
  derivationNeeds,
  pickFields,
  planDerivation,
  planDerivationTrim,
  timelineWords,
  type DerivePick,
  type DeriveSettings,
} from '../agent-tools/derive-plan.ts';
import { videoPlace } from './pipeline-targets.ts';
import { hasVideoDb, videoDirName, type EngineProtection, type VideoLocation, type VideoService } from './video-service.ts';

/**
 * 派生子视频（`videos.derive`、工具 `videos_derive`，架构设计 §3.5「派生子视频」）：复制父视频，把区间之外剪掉，
 * 建在父视频旁边（同一个来源目录、同一层目录），目录名以幂等键结尾。规划见 `derive-plan.ts`。
 *
 * 幂等：同一父视频版本、同一区间与设置的键相同。三层认回：Space 索引里记着这个键的子视频（`findDerived`）、
 * 同一层里以 `-<键>` 结尾且有数据库的目录、子视频里按命令 ID 持久化的回执（复制、收尾与字幕层各一笔，中断后从断处接上）。
 */

export interface DeriveDeps {
  videos: VideoService;
  /** Space 索引里派生自这个父视频、键相同的子视频（视频目录的绝对路径）；没有时 null。 */
  findDerived?: (parentVideoId: Id, key: string) => Promise<string | null> | string | null;
}

/** 按 Space 索引的视频事实（`origin`）找子视频。 */
export function spaceDerivedFinder(space: {
  videos(): { dir: string }[];
  readonly index: { at(dir: string): { facts: { origin?: { parentVideoId: Id; key: string } | null } } | null } | null;
}): NonNullable<DeriveDeps['findDerived']> {
  return (parentVideoId, key) => {
    for (const video of space.videos()) {
      const origin = space.index?.at(video.dir)?.facts.origin;
      if (origin?.parentVideoId === parentVideoId && origin.key === key) return video.dir;
    }
    return null;
  };
}

export interface DeriveOptions {
  taskId?: Id;
  /** 这次调用所在任务的保护范围（只对父视频有意义，子视频是新建的）。 */
  protections?: (videoId: Id) => EngineProtection[];
}

/** 子视频默认名：「父视频名 · mm:ss–mm:ss」。 */
export function defaultDerivedName(parentName: string, range: { start: number; end: number }): string {
  return `${parentName} · ${clockLabel(range.start)}–${clockLabel(range.end)}`;
}

/**
 * 解析参数：补全设置、读要复制的文稿与译文、对齐区间（边界留在句间的停顿里，`alignRange`）、算幂等键。调用方在确认之前
 * 用它拿到摘要里的名字与时刻；`videos.derive` 再用同一份结果规划。
 */
export async function prepareDerive(videos: Pick<VideoService, 'document'>, snapshot: VideoSnapshot, params: Omit<VideoDeriveParams, 'videoId'>) {
  const sequence = snapshot.sequences[snapshot.rootSequenceId]!;
  const settings: DeriveSettings = {
    width: params.width ?? sequence.canvas.width,
    height: params.height ?? sequence.canvas.height,
    fit: params.fit ?? null,
    crop: params.crop ?? null,
    captions: params.captions ?? true,
    translations: params.translations ?? true,
    chapters: params.chapters ?? true,
  };
  const needs = deriveCall(() => derivationNeeds(snapshot, settings));
  const documents = new Map<Id, unknown>();
  for (const id of needs.documentIds) documents.set(id, (await videos.document(snapshot.id, id)).body);
  const range = deriveCall(() => alignRange(sequence, params.start, params.end, timelineWords(snapshot, documents)));
  // 分段取景对到帧、截到区间之后才进设置（幂等键按对齐后的算）；没给时不带这个字段，老调用的键不变。
  const crops = params.crops;
  const aligned = crops?.length ? deriveCall(() => alignCrops(sequence, range, crops)) : null;
  if (aligned) settings.crops = aligned.crops;
  const key = derivationKey({ parentVideoId: snapshot.id, parentRevision: snapshot.revision, range, settings });
  const name = params.name?.trim() || defaultDerivedName(snapshot.name, range);
  return { sequence, range, settings, key, name, needs, documents, cropsAdjusted: aligned?.adjusted ?? 0 };
}

/** 规划里的拒绝换成 RPC 错误（`details.code` 是 `DERIVE_*`）。 */
function deriveCall<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw deriveRpcError(error);
  }
}

export function deriveRpcError(error: unknown): unknown {
  if (!(error instanceof DeriveError)) return error;
  const message =
    error.code === 'DERIVE_RANGE_EMPTY'
      ? RcAgentTools.deriveRangeEmpty()
      : error.code === 'DERIVE_UNSUPPORTED_ITEM'
        ? RcAgentTools.deriveUnsupportedItem({ kind: String(error.details.itemType ?? error.details.kind ?? '') })
        : error.code === 'DERIVE_PANELS_INVALID'
          ? RcAgentTools.derivePanelsInvalid({ layout: String(error.details.layout ?? ''), count: Number(error.details.count ?? 0) })
          : RcAgentTools.deriveParentUnplaced();
  return new RpcError('invalid-request', message, { code: error.code, ...error.details });
}

const CAPTION_ATTEMPTS = 3;

export async function deriveVideo(
  deps: DeriveDeps,
  params: VideoDeriveParams,
  principal: TrustedPrincipal,
  options: DeriveOptions = {},
): Promise<{ result: VideoDeriveResult; opened: VideoOpenResult }> {
  const { videos } = deps;
  const parent = videos.mirror(params.videoId)?.video;
  if (!parent) throw new RpcError('not-found', RcAgentTools.deriveParentUnplaced(), { code: 'VIDEO_NOT_OPEN' });
  const { sequence, range, settings, key, name, needs, documents, cropsAdjusted } = await prepareDerive(videos, parent, params);

  const place = videoPlace(videos, parent.id) as { root: string; file: string; scope: VideoLocation['scope'] } | null;
  // 父视频就是来源目录本身（或不是从项目、会话打开的）：旁边没有地方放子视频。
  if (!place || place.file === '.' || place.file === '') throw deriveRpcError(new DeriveError('DERIVE_PARENT_UNPLACED'));
  const location = (file: string): VideoLocation => ({ root: place.root, file, scope: place.scope });

  // ---- 子视频：认回已有的，或新建 ----
  const siblingsRel = path.posix.dirname(place.file.split(path.sep).join('/'));
  const indexed = await deps.findDerived?.(parent.id, key);
  const indexedRel = indexed ? path.relative(place.root, indexed).split(path.sep).join('/') : null;
  const fromIndex = indexedRel && !indexedRel.startsWith('..') && !path.isAbsolute(indexedRel) && (await hasVideoDb(indexed!)) ? indexedRel : null;
  const existing = fromIndex ?? (await findSibling(path.join(place.root, siblingsRel), key, siblingsRel));
  let opened: VideoOpenResult;
  let reused = false;
  if (existing) {
    opened = await videos.open(location(existing), principal);
    reused = true;
  } else {
    const dirName = `${videoDirName(name).slice(0, 66).trim()}-${key}`;
    const rel = siblingsRel === '.' ? dirName : `${siblingsRel}/${dirName}`;
    const dir = path.join(place.root, rel);
    await fs.mkdir(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    if (await hasVideoDb(dir)) {
      opened = await videos.open(location(rel), principal);
      reused = true;
    } else {
      opened = await videos.create(
        { name, fps: sequence.fps, width: settings.width, height: settings.height, commandId: `derive:${key}:create` },
        place.root,
        place.scope,
        principal,
        rel,
      );
    }
  }
  const childId = opened.ref.videoId;
  const child = () => videos.mirror(childId)?.video ?? opened.snapshot.video;
  const label = RcAgentTools.deriveVideoLabel({ name: parent.name }).text;
  const guard = { ...(options.taskId ? { taskId: options.taskId } : {}), protections: options.protections?.(childId) ?? [] };

  // ---- 读父视频的素材文件，规划（文档正文在 prepareDerive 里读过） ----
  const files = new Map<string, string>();
  for (const asset of needs.assets) {
    const found = await videos.assetFile(parent.id, asset.id, asset.revision).catch((error: unknown) => {
      // 不能经媒体通道给出去的链接素材（目录、字幕文件等）：不能复制。
      if (error instanceof RpcError && error.code === 'forbidden') {
        throw deriveRpcError(new DeriveError('DERIVE_UNSUPPORTED_ITEM', { assetId: asset.id, kind: parent.assets[asset.id]?.kind ?? 'asset' }));
      }
      throw error;
    });
    files.set(assetFileKey(asset), path.resolve(found.root, found.file));
  }
  const childSequence = child().sequences[child().rootSequenceId]!;
  const plan = deriveCall(() =>
    planDerivation({
      snapshot: parent,
      range,
      settings,
      key,
      target: { sequenceId: childSequence.id, tracks: childSequence.tracks, background: childSequence.canvas.background },
      files,
      documents,
      labels: { derivationName: RcAgentTools.derivationDocumentName().text },
      cropsAdjusted,
      pick: { ...(params.hook !== undefined ? { hook: params.hook } : {}), ...(params.reason !== undefined ? { reason: params.reason } : {}), ...(params.notes ? { notes: params.notes } : {}) },
    }),
  );

  // ---- 第一笔：复制 ----
  const copyCommand = `derive:${key}:apply`;
  let copyReceipt: TransactionReceipt | null = await videos.receiptFor(childId, copyCommand);
  const alreadyCopied = Object.values(child().documents).some((d) => d.kind === DERIVATION_KIND);
  if (!copyReceipt && !alreadyCopied) {
    const result = await videos.apply(
      { videoId: childId, commandId: copyCommand, expectedRevision: child().revision, operations: plan.operations as never, label },
      principal,
      guard,
    );
    copyReceipt = result.receipt;
  }
  const refs = copyReceipt?.refs ?? {};

  // ---- 第二笔：收尾与剪口 ----
  const trimCommand = `derive:${key}:trim`;
  let trimReceipt: TransactionReceipt | null = copyReceipt ? await videos.receiptFor(childId, trimCommand) : null;
  if (copyReceipt && !trimReceipt) {
    const now = child();
    const operations = planDerivationTrim(plan, { sequence: now.sequences[now.rootSequenceId]!, documents: now.documents }, refs);
    if (operations.length) {
      const result = await videos.apply(
        { videoId: childId, commandId: trimCommand, expectedRevision: now.revision, operations: operations as never, label },
        principal,
        guard,
      );
      trimReceipt = result.receipt;
    }
  }
  const trimRefs = trimReceipt?.refs ?? {};

  // ---- 字幕层：按剪辑后的时间线，每个素材至多一层 ----
  const warnings: VideoDeriveResult['warnings'] = [...plan.warnings];
  const captions: VideoDeriveResult['captions'] = [];
  if (settings.captions) {
    // 字幕条数只数剪完之后还看得到的：落在区间里播放的源区间之内的（字幕在素材时钟上）。
    const keptOf = (assetId: Id | undefined) => plan.kept.filter((k) => k.assetId === assetId);
    const reader = {
      document: async (v: Id, d: Id, revision?: string) => {
        const content = await videos.document(v, d, revision);
        return { revision: content.revision, body: content.body };
      },
    };
    for (const [n, speech] of captionSources(plan.speech, parent).entries()) {
      const documentId = refs[speech.ref];
      if (!documentId) continue;
      const source = { kind: 'speech' as const, documentId };
      const inRange = keptOf(speech.assetId);
      const made = await captionLayer(videos, reader, childId, source, `derive:${key}:captions:${n + 1}`, principal, guard, inRange);
      if (made === 'skipped') warnings.push({ code: 'captions-skipped', documentId });
      else captions.push({ documentId: made.documentId, sourceDocumentId: documentId, cueCount: made.cueCount });
    }
    // 译文：父视频里有字幕层的译文同样建一层（与父视频对应）；父视频的原文字幕层显示着时是双语。
    const parentSequence = parent.sequences[parent.rootSequenceId]!;
    for (const [n, t] of plan.trim.translations.entries()) {
      const documentId = trimRefs[`translation-${n + 1}`];
      if (!documentId || !existingCaptionLayer(parentSequence, parent.documents, t.from)) continue;
      const speechId = parent.documents[t.from]?.sourceDocumentId;
      const original = speechId ? existingCaptionLayer(parentSequence, parent.documents, speechId) : null;
      const bilingual = !!original && parentSequence.items.some((item) => original.itemIds.includes(item.id) && item.enabled);
      const source = { kind: 'translation' as const, documentId, bilingual, cues: 'sentence-alignment' as const };
      const inRange = keptOf(plan.speech.find((s) => s.ref === t.speechRef)?.assetId);
      const made = await captionLayer(videos, reader, childId, source, `derive:${key}:translation-captions:${n + 1}`, principal, guard, inRange);
      if (made === 'skipped') warnings.push({ code: 'captions-skipped', documentId });
      else captions.push({ documentId: made.documentId, sourceDocumentId: documentId, cueCount: made.cueCount });
    }
  }

  const final = child();
  const translations = Object.values(final.documents)
    .filter((d) => d.kind === 'translation' && d.sourceDocumentId && Object.values(refs).includes(d.sourceDocumentId))
    .map((d) => ({ documentId: d.id, sourceDocumentId: d.sourceDocumentId! }));
  const video: VideoCreated = {
    videoId: childId,
    videoName: final.name,
    target: { ...(place.scope), path: opened.ref.relPath },
    videoRevision: final.revision,
  };
  // 挑选说明按子视频里派生来源文档的现状回显：认回已有的子视频时它不改写，回显的是原来那份，不是这次传的。
  const derivationDocumentId = Object.values(final.documents).find((d) => d.kind === DERIVATION_KIND)?.id ?? null;
  const derivationBody = derivationDocumentId ? ((await videos.document(childId, derivationDocumentId)).body as DerivePick | null) : null;
  const pick = pickFields(derivationBody ?? undefined);
  const result: VideoDeriveResult = {
    video,
    reused,
    key,
    range: { start: range.start, end: range.end },
    primaryAssetId: plan.derivation.primaryAssetId,
    cuts: plan.cuts,
    itemCount: plan.itemCount,
    ...(settings.crops ? { framing: settings.crops } : {}),
    derivationDocumentId,
    ...pick,
    speech: plan.speech.flatMap((s) => (refs[s.ref] ? [{ documentId: refs[s.ref]!, sourceDocumentId: s.from, words: s.words }] : [])),
    translations,
    captions,
    warnings,
  };
  return { result, opened: { ...opened, snapshot: videos.mirror(childId) ?? opened.snapshot } };
}

/** 同一层里以 `-<键>` 结尾、有数据库的目录（相对来源目录）。 */
async function findSibling(dir: string, key: string, rel: string): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(`-${key}`)) continue;
    if (await hasVideoDb(path.join(dir, entry.name))) return rel === '.' ? entry.name : `${rel}/${entry.name}`;
  }
  return null;
}

/** 每个素材至多建一层字幕：父视频里已有字幕层的那份转写优先，否则取最后一份。 */
function captionSources<S extends { from: Id; assetId: Id }>(speech: S[], parent: VideoSnapshot): S[] {
  const sequence = parent.sequences[parent.rootSequenceId]!;
  const byAsset = new Map<Id, S>();
  for (const s of speech) {
    const current = byAsset.get(s.assetId);
    const layered = existingCaptionLayer(sequence, parent.documents, s.from) !== null;
    const currentLayered = current ? existingCaptionLayer(sequence, parent.documents, current.from) !== null : false;
    if (!current || layered || !currentLayered) byAsset.set(s.assetId, s);
  }
  return [...byAsset.values()];
}

async function captionLayer(
  videos: VideoService,
  reader: Parameters<typeof planCaptionLayer>[0],
  videoId: Id,
  source: CaptionSource,
  command: string,
  principal: TrustedPrincipal,
  guard: { taskId?: Id; protections: EngineProtection[] },
  kept: readonly { from: number; to: number }[],
): Promise<{ documentId: Id; cueCount: number | null } | 'skipped'> {
  for (let attempt = 1; ; attempt++) {
    const commandId = attempt === 1 ? command : `${command}:${attempt}`;
    const done = await videos.receiptFor(videoId, commandId);
    const video = videos.mirror(videoId)!.video;
    const sequence = video.sequences[video.rootSequenceId]!;
    const layer = existingCaptionLayer(sequence, video.documents, source.documentId);
    if (done || layer) return { documentId: layer?.documentId ?? done?.refs?.caption ?? source.documentId, cueCount: null };
    let plan: Awaited<ReturnType<typeof planCaptionLayer>>;
    try {
      plan = await planCaptionLayer(reader, {
        videoId,
        sequence,
        documents: video.documents as Record<Id, DocumentRecord>,
        source,
        pairOriginal: source.kind === 'speech',
      });
    } catch (error) {
      if (error instanceof PipelineStepError) return 'skipped';
      throw error;
    }
    if ('reason' in plan) return 'skipped';
    try {
      const result = await videos.apply(
        {
          videoId,
          commandId,
          expectedRevision: video.revision,
          operations: plan.operations as EditOperation[] as never,
          label: RcAgentTools.captionsLabel().text,
        },
        principal,
        guard,
      );
      const document = plan.operations.find((o) => o.type === 'putDocument' && o.ref === CAPTION_DOCUMENT_REF) as { body?: unknown } | undefined;
      return { documentId: result.receipt.refs?.caption ?? source.documentId, cueCount: cuesInRange(document?.body, kept) ?? plan.cueCount };
    } catch (error) {
      const code = error instanceof RpcError ? (error.details as { code?: unknown } | null)?.code : undefined;
      const conflict = error instanceof RpcError && (error.code === 'conflict' || code === 'PROJECT_REVISION_CONFLICT');
      if (conflict && attempt < CAPTION_ATTEMPTS) continue;
      throw error;
    }
  }
}
