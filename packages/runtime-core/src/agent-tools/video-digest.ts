// i18n-ignore-file: 给模型的视频摘要与操作格式错误（OperationShapeError）
import os from 'node:os';
import path from 'node:path';
import {
  framesToSeconds,
  itemAssetRef,
  itemAssetRefs,
  itemRangeSeconds,
  itemTimeMap,
  mediaTimeToSeconds,
  sequenceDurationFrames,
  type DuckingGroup,
  type DuckingTrigger,
  type EmbeddedAudio,
  type HistoryEntry,
  type Id,
  type VideoSnapshot,
  type Rate,
  type Sequence,
  type SequenceItem,
  type TransactionReceipt,
  type VisualItem,
  type AssetRevision,
} from '@baocut/protocol';
import { sourceChapters } from '@baocut/editor-wasm';

/**
 * 给智能体看的视频摘要（架构设计 §3.7：按范围读取）。字段只留做决定需要的：稳定 ID、秒与帧、
 * 素材的类型与时长、文档头。时间同时给秒（便于理解）和帧（引擎的权威单位）。文档的正文不在摘要里。
 */

export interface DigestOptions {
  /** 只列与这段时间（秒）相交的片段。 */
  from?: number;
  to?: number;
  /** 最多列多少个片段；多出来的如实标为截断。 */
  limit?: number;
}

const DEFAULT_ITEM_LIMIT = 200;
/** 文字实例的内容在摘要里最多留这么多字。 */
const TEXT_PREVIEW_CHARS = 120;

export function digestVideo(snapshot: VideoSnapshot, videoPath: string, history: HistoryEntry[], options: DigestOptions = {}) {
  const sequence = snapshot.sequences[snapshot.rootSequenceId];
  if (!sequence) throw new Error('Video has no root sequence');
  const fps = sequence.fps;
  const assets = Object.values(snapshot.assets);
  const from = options.from ?? 0;
  const to = options.to ?? Number.POSITIVE_INFINITY;
  const limit = options.limit ?? DEFAULT_ITEM_LIMIT;

  const inRange = sequence.items
    .map((item) => ({ item, range: itemRangeSeconds(item, fps) }))
    .filter(({ range }) => range.end > from && range.start < to)
    .sort((a, b) => a.range.start - b.range.start || trackOrder(sequence, a.item) - trackOrder(sequence, b.item));
  const listed = inRange.slice(0, limit);

  return {
    videoId: snapshot.id,
    video: videoPath,
    name: snapshot.name,
    revision: snapshot.revision,
    sequence: {
      id: sequence.id,
      fps: formatRate(fps),
      canvas: `${sequence.canvas.width}x${sequence.canvas.height}`,
      durationSeconds: round(framesToSeconds(sequenceDurationFrames(sequence), fps)),
      durationFrames: sequenceDurationFrames(sequence),
    },
    tracks: [...sequence.tracks]
      .sort((a, b) => a.order - b.order)
      .map((track) => ({
        id: track.id,
        kind: track.kind,
        name: track.name ?? null,
        locked: track.locked,
        visible: track.visible,
        muted: track.muted,
        items: sequence.items.filter((item) => item.trackId === track.id).length,
      })),
    items: listed.map(({ item, range }) => describeItem(item, range, snapshot)),
    itemsCoverage: {
      fromSeconds: from,
      toSeconds: Number.isFinite(to) ? to : null,
      matched: inRange.length,
      listed: listed.length,
      truncated: listed.length < inRange.length,
    },
    transitions: sequence.transitions.map((t) => ({
      id: t.id,
      kind: t.kind,
      ...(t.params && Object.keys(t.params).length ? { params: t.params } : {}),
      ...(t.leftItemId ? { leftItemId: t.leftItemId } : {}),
      ...(t.rightItemId ? { rightItemId: t.rightItemId } : {}),
      durationSeconds: round(framesToSeconds(t.durationFrames, fps)),
      durationFrames: t.durationFrames,
      easing: t.easing,
      placement: t.placement,
      ...(t.audioCrossfade ? { audioCrossfade: true } : {}),
    })),
    chapters: sequence.markers
      .filter((m) => m.kind === 'chapter')
      .map((m) => ({
        id: m.id,
        title: m.label,
        atSeconds: round(framesToSeconds(m.frame, fps)),
        atFrame: m.frame,
        ...(m.summary !== undefined ? { summary: m.summary } : {}),
        ...(m.thumbnail ? { thumbnailAssetId: m.thumbnail.id } : {}),
      })),
    ducking: (sequence.ducking ?? []).map((rule) => ({
      id: rule.id,
      ...(rule.name ? { name: rule.name } : {}),
      enabled: rule.enabled,
      trigger: describeTrigger(rule.trigger),
      target: describeGroup(rule.target),
      depth: rule.depth,
      attackSeconds: round(mediaTimeToSeconds(rule.attack)),
      releaseSeconds: round(mediaTimeToSeconds(rule.release)),
    })),
    assets: assets
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((asset) => {
        const revision = asset.revisions[asset.currentRevision];
        return {
          id: asset.id,
          name: asset.name,
          kind: asset.kind,
          durationSeconds: revision?.duration && asset.kind !== 'image' ? round(mediaTimeToSeconds(revision.duration)) : null,
          size: revision?.video ? `${revision.video.displayWidth}x${revision.video.displayHeight}` : null,
          hasAudio: Boolean(revision?.audio),
          storage: revision?.storage.mode ?? null,
          ...(revision?.tree ? { files: revision.tree.fileCount } : {}),
          ...(asset.kind === 'bundle' ? bundleIdentity(revision?.bundle) : {}),
          ...sourceBlock(revision),
          usedBy: sequence.items.filter((item) => itemAssetRefs(item).some((ref) => ref.id === asset.id)).length,
        };
      }),
    documents: Object.values(snapshot.documents)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((document) => {
        const summary = document.revisions[document.currentRevision]?.summary;
        return {
          id: document.id,
          kind: document.kind,
          name: document.name,
          language: document.language ?? null,
          revision: document.currentRevision,
          ...(document.sourceAssetId ? { sourceAssetId: document.sourceAssetId } : {}),
          ...(document.sourceDocumentId ? { sourceDocumentId: document.sourceDocumentId } : {}),
          ...(summary !== undefined ? { summary } : {}),
          usedBy: sequence.items.filter(
            (item) => item.type === 'caption' && (item.documentId === document.id || item.styleDocumentId === document.id),
          ).length,
        };
      }),
    recentHistory: history.slice(0, 10).map((entry) => ({
      transactionId: entry.transactionId,
      label: entry.label,
      by: entry.actor.kind,
      revision: entry.videoRevision,
      undone: Boolean(entry.undoneBy),
      ...(entry.undoOf ? { undoOf: entry.undoOf } : {}),
    })),
  };
}

/** 素材来源里简介在摘要中最多保留的字符数（完整的在素材的 `provenance.source.description`）。 */
const SOURCE_DESCRIPTION_CHARS = 1200;

/** 来源平台的元数据：从链接导入的素材（视频格式规范 §4.5），或来源里带着这些字段的。 */
function isPlatformSource(
  provenance: AssetRevision['provenance'] | undefined,
): provenance is { origin: string; source: Record<string, unknown> } {
  const source = provenance?.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  if (provenance.origin === 'link-import') return true;
  return ['description', 'chapters', 'webpageUrl', 'uploader'].some((key) => key in source);
}

/**
 * `assets[].source`：来源平台的标题、发布者、简介（截到 1200 个字符）与作者章节（结构化 `chapters[]` 优先，没有时是简介里的
 * 时间戳大纲；源时间秒，未吸附）。润色与识别说话人时当背景参考，采用章节用 `chapters_adopt`。章节由字幕与翻译核心解析
 * （`bc_source_chapters`，不吸附）；WASM 没有构建时退回到结构化章节，简介不解析。
 */
function sourceBlock(revision: AssetRevision | undefined) {
  const provenance = revision?.provenance;
  if (!isPlatformSource(provenance)) return {};
  const { source } = provenance;
  const text = (key: string) => (typeof source[key] === 'string' && source[key] ? (source[key] as string) : null);
  const description = text('description');
  const chars = description ? [...description] : [];
  return {
    source: {
      platform: text('platform'),
      webpageUrl: text('webpageUrl'),
      uploader: text('uploader'),
      uploadDate: text('uploadDate'),
      title: text('title'),
      description: chars.length > SOURCE_DESCRIPTION_CHARS ? chars.slice(0, SOURCE_DESCRIPTION_CHARS).join('') : description,
      descriptionTruncated: chars.length > SOURCE_DESCRIPTION_CHARS,
      chapters: authorChapters(source, revision?.duration ? mediaTimeToSeconds(revision.duration) : 0),
    },
  };
}

function authorChapters(source: Record<string, unknown>, durationSeconds: number): Array<{ at: number; title: string }> {
  try {
    return sourceChapters({ source, durationSeconds, snap: false }).sourceChapters.map((c) => ({ at: round(c.start), title: c.title }));
  } catch {
    // 摘要不因为可选的补充失败：WASM 没有构建或来源读不懂时，只列结构化章节（导入时已经清洗过）。
    const raw = Array.isArray(source.chapters) ? (source.chapters as unknown[]) : [];
    return raw.flatMap((item) => {
      const { start, title } = (item ?? {}) as { start?: unknown; title?: unknown };
      return typeof start === 'number' && Number.isFinite(start) && typeof title === 'string' && title.trim()
        ? [{ at: round(start), title: title.trim() }]
        : [];
    });
  }
}

/** 代码包素材的清单身份：包的 bundleId 与清单的 revision（改文案、改色后重新打包时递增），用来分辨同一个包的不同版本。 */
function bundleIdentity(manifest: unknown): { bundleId?: string; manifestRevision?: string } {
  if (!manifest || typeof manifest !== 'object') return {};
  const { bundleId, revision } = manifest as { bundleId?: unknown; revision?: unknown };
  return {
    ...(typeof bundleId === 'string' ? { bundleId } : {}),
    ...(typeof revision === 'string' ? { manifestRevision: revision } : {}),
  };
}

function describeItem(item: SequenceItem, range: { start: number; end: number }, snapshot: VideoSnapshot) {
  const assetRef = itemAssetRef(item);
  const startFrame = item.type === 'audio' ? item.fromFrame : item.span.fromFrame;
  const timeMap = itemTimeMap(item);
  return {
    id: item.id,
    type: item.type,
    trackId: item.trackId,
    name: item.name ?? null,
    ...(item.role ? { role: item.role } : {}),
    ...(assetRef ? { asset: { id: assetRef.id, revision: assetRef.revision, name: snapshot.assets[assetRef.id]?.name ?? null } } : {}),
    ...describeContent(item, snapshot),
    startSeconds: round(range.start),
    endSeconds: round(range.end),
    startFrame,
    ...(item.type === 'audio' ? {} : { durationFrames: item.span.durationFrames }),
    ...(timeMap?.kind === 'linear' ? { sourceInSeconds: round(mediaTimeToSeconds(timeMap.sourceIn)) } : {}),
    ...describePlace(item),
    ...describeSound(item),
    ...describeLook(item),
    enabled: item.enabled,
    locked: item.locked,
  };
}

/** 各类型自己的内容：文字或计时读数、合成的预渲染替身、字幕指向的文档。图形的几何、各类样式、生成类元素与合成的参数不进摘要。 */
function describeContent(item: SequenceItem, snapshot: VideoSnapshot): Record<string, unknown> {
  switch (item.type) {
    case 'text': {
      if (item.counter) return { counter: item.counter };
      const text = item.text ?? '';
      return { text: text.length > TEXT_PREVIEW_CHARS ? `${text.slice(0, TEXT_PREVIEW_CHARS)}…` : text };
    }
    case 'composition':
      return item.prerender
        ? {
            prerender: { id: item.prerender.id, revision: item.prerender.revision, name: snapshot.assets[item.prerender.id]?.name ?? null },
          }
        : {};
    case 'caption':
      return {
        document: { id: item.documentId, name: snapshot.documents[item.documentId]?.name ?? null },
        ...(item.styleDocumentId ? { styleDocumentId: item.styleDocumentId } : {}),
        ...(item.scopeItemIds?.length ? { scopeItemIds: item.scopeItemIds } : {}),
      };
    default:
      return {};
  }
}

/** 有 `mode` 的视觉媒体：铺满画布时 `place` 的位置、宽与缩放不参与。 */
const MEDIA_TYPES = new Set<SequenceItem['type']>(['video', 'image', 'sticker', 'placeholder', 'whiteboard']);

/**
 * 画面实例的摆法（`place`，画幅的百分比）：`x`、`y` 是框中心，`w` 是框宽占画幅宽的百分比，只列写了的字段（省略的取按种类的缺省）。
 * 视觉媒体带 `mode`；铺满画布（`fullscreen`，合成是 `place` 没写位置与宽时）只列旋转、镜像与不透明度。
 */
function describePlace(item: SequenceItem): Record<string, unknown> {
  if (item.type === 'audio' || item.type === 'caption') return {};
  const place = item.place;
  const fullscreen = MEDIA_TYPES.has(item.type)
    ? mediaMode(item) === 'fullscreen'
    : item.type === 'composition' && place.x === undefined && place.y === undefined && place.w === undefined;
  const out: Record<string, unknown> = {};
  if (MEDIA_TYPES.has(item.type) || item.type === 'composition') out.mode = fullscreen ? 'fullscreen' : 'pip';
  const fields = fullscreen ? (['rot'] as const) : (['x', 'y', 'w', 'scale', 'scaleY', 'rot'] as const);
  for (const key of fields) if (place[key] !== undefined) out[key] = round(place[key], 2);
  if (place.flipX) out.flipX = true;
  if (place.flipY) out.flipY = true;
  if (place.opacity !== undefined && place.opacity !== 1) out.opacity = round(place.opacity, 2);
  return Object.keys(out).length > 0 ? { place: out } : {};
}

function mediaMode(item: VisualItem): 'fullscreen' | 'pip' {
  return 'mode' in item && item.mode === 'fullscreen' ? 'fullscreen' : 'pip';
}

/** 声音：音频实例的混音、视频自带的声音、合成自己的声音。音量是线性倍数（1 为原音量）。 */
function describeSound(item: SequenceItem): Record<string, unknown> {
  const fades = (audio: { fadeIn?: { ticks: string; timescale: number }; fadeOut?: { ticks: string; timescale: number } }) => ({
    ...(audio.fadeIn ? { fadeInSeconds: round(mediaTimeToSeconds(audio.fadeIn)) } : {}),
    ...(audio.fadeOut ? { fadeOutSeconds: round(mediaTimeToSeconds(audio.fadeOut)) } : {}),
  });
  const embedded = (audio: EmbeddedAudio) => ({ enabled: audio.enabled, volume: round(audio.volume), ...fades(audio) });
  switch (item.type) {
    case 'audio':
      return { volume: round(item.mix.volume), ...(item.mix.muted ? { muted: true } : {}), ...fades(item.mix) };
    case 'video':
      return { embeddedAudio: embedded(item.embeddedAudio) };
    case 'composition':
      return item.audio ? { audio: embedded(item.audio) } : {};
    default:
      return {};
  }
}

/** 裁剪与效果：效果只列写了的 `fx` 字段名，取值不进摘要。 */
function describeLook(item: SequenceItem): Record<string, unknown> {
  const look: Record<string, unknown> = {};
  if ((item.type === 'video' || item.type === 'image') && item.crop) look.crop = item.crop;
  const fx = item.type === 'audio' || item.type === 'caption' || !('fx' in item) ? undefined : item.fx;
  if (fx && Object.keys(fx).length > 0) look.fx = Object.keys(fx);
  return look;
}

/** 闪避的触发：说话时，或这些轨道与实例发声时。 */
function describeTrigger(trigger: DuckingTrigger): Record<string, unknown> {
  return trigger.kind === 'speech' ? { kind: 'speech' } : { kind: 'items', ...describeGroup(trigger) };
}

/** 闪避规则的一组：空的一半省略。 */
function describeGroup(group: DuckingGroup): DuckingGroup {
  return {
    ...(group.trackIds?.length ? { trackIds: group.trackIds } : {}),
    ...(group.itemIds?.length ? { itemIds: group.itemIds } : {}),
  };
}

function trackOrder(sequence: Sequence, item: SequenceItem): number {
  return sequence.tracks.find((track) => track.id === item.trackId)?.order ?? 0;
}

/** 回执摘要：工具结果与变更卡都从这里取，不从模型的说法里取（命令与协议规范 §5）。 */
export function digestReceipt(receipt: TransactionReceipt, fps: Rate, replayed: boolean) {
  return {
    status: receipt.status,
    replayed,
    transactionId: receipt.transactionId,
    label: receipt.label,
    revision: { before: receipt.previousRevision, after: receipt.videoRevision },
    createdIds: receipt.createdIds,
    updatedIds: receipt.updatedIds,
    deletedIds: receipt.deletedIds,
    ...(Object.keys(receipt.lineage).length ? { lineage: receipt.lineage } : {}),
    durationSeconds: {
      before: round(framesToSeconds(receipt.impact.oldDurationFrames, fps)),
      after: round(framesToSeconds(receipt.impact.newDurationFrames, fps)),
    },
    timeResolution: receipt.timeResolution.map((t) => ({
      requested: t.requested.unit === 'seconds' ? `${t.requested.value}s` : `${t.requested.value}f`,
      actualFrame: t.actualFrame,
      actualSeconds: round(mediaTimeToSeconds(t.actualTime)),
      deltaMs: round(mediaTimeToSeconds(t.delta) * 1000, 1),
      policy: t.policy,
    })),
    ...(receipt.impact.removedTransitions?.length ? { removedTransitions: receipt.impact.removedTransitions } : {}),
    ...(receipt.impact.shortenedTransitions?.length ? { shortenedTransitions: receipt.impact.shortenedTransitions } : {}),
    ...(receipt.impact.removedByCuts?.length ? { removedByCuts: receipt.impact.removedByCuts } : {}),
    ...(receipt.impact.cutsNotRelaid?.length ? { cutsNotRelaid: receipt.impact.cutsNotRelaid } : {}),
    ...(receipt.impact.removedWithTarget?.length ? { removedWithTarget: receipt.impact.removedWithTarget } : {}),
    ...(receipt.impact.codeEdits?.length ? { codeEdits: receipt.impact.codeEdits } : {}),
    ...(receipt.impact.removedTracks?.length ? { removedTracks: receipt.impact.removedTracks } : {}),
    ...(receipt.impact.removedAssets?.length ? { removedAssets: receipt.impact.removedAssets } : {}),
    ...(receipt.impact.orphanedAnchors.length ? { orphanedAnchors: receipt.impact.orphanedAnchors } : {}),
    undoAvailable: receipt.undo.available,
    ...(receipt.undoOf ? { undoOf: receipt.undoOf } : {}),
  };
}

// ---- 操作的规范化 ----

/** 这些操作带时间：缺 `sequenceId` 时用根序列，缺 `alignment` 时取最近的帧。 */
const TIMED = new Set(['addItem', 'moveItem', 'moveItems', 'trimItem', 'splitItem', 'removeRange', 'setTransition', 'setChapters', 'upsertChapter']);
const SEQUENCE_SCOPED = new Set([
  ...TIMED,
  'deleteItems',
  'addTrack',
  'deleteTrack',
  'updateTrack',
  'updateSequence',
  'setDucking',
  'addCuts',
  'restoreCut',
  'acceptCutSuggestions',
]);

export class OperationShapeError extends Error {
  readonly index: number;
  constructor(index: number, message: string) {
    super(`第 ${index + 1} 个操作：${message}`);
    this.name = 'OperationShapeError';
    this.index = index;
  }
}

/**
 * 把智能体写的操作补成引擎的标准形态（命令与协议规范 §4.2、§6.1）。只补默认值、换时间写法，
 * 不改语义；字段与取值的校验仍在引擎里做，未知字段由引擎拒绝。
 *
 * - 时间可以写成数字或数字字符串（秒），换成 `{ unit: 'seconds', value }`；`{ unit, value }` 原样保留。
 * - `setAudioMix` 的淡入淡出、`setDucking` 的 attack / release 可以写数字（秒），换成十进制字符串。
 * - `setTransition.duration`、`setChapters` 每一章的 `at`、`upsertChapter.at` 与 `removeRange` 的 `from` / `to` 同上换成时间输入。
 * - `addItem.asset` 与章节的 `thumbnail` 可以直接写素材 ID。
 * - `importAsset.path` 相对会话的工作目录；`~/` 展开为主目录。
 */
export function normalizeOperations(operations: unknown[], rootSequenceId: Id, cwd: string): Record<string, unknown>[] {
  return operations.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new OperationShapeError(index, '要是一个对象');
    const op: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
    const type = op.type;
    if (typeof type !== 'string') throw new OperationShapeError(index, '缺少 type');
    if (SEQUENCE_SCOPED.has(type) && op.sequenceId === undefined) op.sequenceId = rootSequenceId;
    if (TIMED.has(type) && op.alignment === undefined) op.alignment = 'nearest-frame';
    for (const key of ['at', 'offset'] as const) {
      if (op[key] !== undefined) op[key] = timeInput(op[key], index);
    }
    if (type === 'removeRange') {
      for (const key of ['from', 'to'] as const) {
        if (op[key] !== undefined) op[key] = timeInput(op[key], index);
      }
    }
    if (type === 'moveItems' && Array.isArray(op.moves)) {
      op.moves = op.moves.map((move) => {
        if (typeof move !== 'object' || move === null) return move;
        const next: Record<string, unknown> = { ...(move as Record<string, unknown>) };
        for (const key of ['at', 'offset'] as const) {
          if (next[key] !== undefined) next[key] = timeInput(next[key], index);
        }
        return next;
      });
    }
    if (type === 'setAudioMix' || type === 'setDucking') {
      for (const key of type === 'setAudioMix' ? ['fadeIn', 'fadeOut'] : ['attack', 'release']) {
        if (typeof op[key] === 'number' && Number.isFinite(op[key])) op[key] = decimal(op[key]);
      }
    }
    if (type === 'setTransition' && op.duration !== undefined) op.duration = timeInput(op.duration, index);
    // 剪口是源素材时钟上的十进制秒，不是序列时间。
    if (type === 'addCuts' && Array.isArray(op.cuts)) {
      op.cuts = op.cuts.map((cut) => {
        if (typeof cut !== 'object' || cut === null) return cut;
        const next: Record<string, unknown> = { ...(cut as Record<string, unknown>) };
        for (const key of ['from', 'to'] as const) {
          if (typeof next[key] === 'number' && Number.isFinite(next[key])) next[key] = decimal(next[key]);
        }
        return next;
      });
    }
    // 剪辑建议的检测参数：秒数可以写数字，换成十进制字符串。
    if (type === 'proposeCuts' && typeof op.detect === 'object' && op.detect !== null && !Array.isArray(op.detect)) {
      const detect: Record<string, unknown> = { ...(op.detect as Record<string, unknown>) };
      for (const key of ['minPause', 'compressTo', 'maxGap'] as const) {
        if (typeof detect[key] === 'number' && Number.isFinite(detect[key])) detect[key] = decimal(detect[key]);
      }
      op.detect = detect;
    }
    if (type === 'upsertChapter' && typeof op.thumbnail === 'string') op.thumbnail = { assetId: op.thumbnail };
    if (type === 'setChapters' && Array.isArray(op.chapters)) {
      op.chapters = op.chapters.map((chapter) => {
        if (typeof chapter !== 'object' || chapter === null) return chapter;
        const next: Record<string, unknown> = { ...(chapter as Record<string, unknown>) };
        if (next.at !== undefined) next.at = timeInput(next.at, index);
        if (typeof next.thumbnail === 'string') next.thumbnail = { assetId: next.thumbnail };
        return next;
      });
    }
    if (type === 'addItem' && typeof op.asset === 'string') op.asset = { assetId: op.asset };
    if (type === 'importAsset' && typeof op.path === 'string') op.path = resolveUserPath(op.path, cwd);
    return op;
  });
}

function timeInput(value: unknown, index: number): unknown {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new OperationShapeError(index, '时间不是有限的数');
    return { unit: 'seconds', value: decimal(value) };
  }
  if (typeof value === 'string') {
    const text = value.trim().replace(/s$/, '');
    if (!/^-?\d+(\.\d+)?$/.test(text)) throw new OperationShapeError(index, `看不懂的时间「${value}」：写秒数，例如 1.5`);
    return { unit: 'seconds', value: text };
  }
  return value;
}

function decimal(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

/** 用户给的路径：`~/` 展开成主目录，相对路径对 `cwd` 解析。 */
export function resolveUserPath(file: string, cwd: string): string {
  if (file === '~' || file.startsWith('~/')) return path.join(os.homedir(), file.slice(1));
  return path.resolve(cwd, file);
}

function formatRate(rate: Rate): string {
  return rate.den === 1 ? String(rate.num) : `${rate.num}/${rate.den}`;
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
