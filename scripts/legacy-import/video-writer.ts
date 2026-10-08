// 把一份计划写成视频目录。每一步是一笔带固定 commandId 的事务：已经提交过的步骤重跑时直接取回执，不重复写。

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { EngineFailure } from './engine-host.ts';
import type { EngineHost, Receipt } from './engine-host.ts';
import { count } from './video-plan.ts';
import type { AssetInfo, AssetPlan, ItemPlan, Json, VideoContent, ProjectPlan } from './video-plan.ts';

export const IMPORTER = { name: 'baocut-legacy-import', version: 1 };

interface Snapshot {
  revision: string;
  assets: Record<string, AssetRecord>;
  documents: Record<string, { id: string; kind: string; currentRevision: string }>;
  rootSequenceId: string;
  sequences: Record<string, { tracks: { id: string; kind: string; name?: string }[]; items: SnapshotItem[] }>;
}

interface SnapshotItem {
  id: string;
  type: string;
  extensions?: Record<string, { sourceId?: string }>;
}

interface AssetRecord {
  id: string;
  kind: string;
  currentRevision: string;
  revisions: Record<
    string,
    {
      contentHash: string;
      duration?: { ticks: string; timescale: number };
      video?: { displayWidth: number; displayHeight: number };
      audio?: unknown;
    }
  >;
}

interface Opened {
  videoId: string;
  path: string;
  snapshot: Snapshot;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

class VideoSession {
  readonly host: EngineHost;
  readonly videoId: string;
  constructor(host: EngineHost, videoId: string) {
    this.host = host;
    this.videoId = videoId;
  }

  /**
   * 提交一步；这一步以前提交过就取回原来的回执。内容与上次不同说明计划变了，不能悄悄叠加。
   * `operations` 可以是一个函数：操作要看视频当前状态才能定的步骤（建轨道），重跑时不再重新推导，用 `fingerprint` 认出同一份计划。
   */
  async step(command: string, label: string, operations: unknown[] | (() => unknown[]), fingerprint?: unknown): Promise<Receipt> {
    const commandId = `legacy-import:${command}`;
    // 引擎只保存标签的前 200 个 Unicode 字符；先截短说明，保证内容摘要不会被截掉。
    const suffix = ` #${digest(fingerprint ?? operations)}`;
    const marked = `${[...label].slice(0, 200 - suffix.length).join('')}${suffix}`;
    const { receipt } = await this.host.request<{ receipt: (Receipt & { label: string }) | null }>('receipts.byCommand', {
      videoId: this.videoId,
      commandId,
    });
    if (receipt) {
      if (receipt.label !== marked) throw new Error(`「${label}」上次导入的内容与这次不同：用 --replace 重建这个视频`);
      return receipt;
    }
    return this.host.apply(this.videoId, commandId, marked, typeof operations === 'function' ? operations() : operations);
  }

  /** 这一步以前提交过没有。 */
  async committed(command: string): Promise<boolean> {
    const { receipt } = await this.host.request<{ receipt: unknown }>('receipts.byCommand', {
      videoId: this.videoId,
      commandId: `legacy-import:${command}`,
    });
    return receipt != null;
  }

  async snapshot(): Promise<Snapshot> {
    const { snapshot } = await this.host.request<{ snapshot: Snapshot }>('videos.snapshot', { videoId: this.videoId });
    return snapshot;
  }
}

function assetInfo(record: AssetRecord): AssetInfo {
  const revision = record.revisions[record.currentRevision];
  const duration = revision.duration;
  return {
    id: record.id,
    revision: record.currentRevision,
    kind: record.kind,
    width: revision.video?.displayWidth,
    height: revision.video?.displayHeight,
    durationUs: duration ? (BigInt(duration.ticks) * 1_000_000n) / BigInt(duration.timescale) : undefined,
    hasAudio: revision.audio != null,
    contentHash: revision.contentHash,
  };
}

/** 预演：不碰引擎，用旧格式自己记下的信息代替探测结果。 */
export function dryAssets(plan: ProjectPlan): Map<string, AssetInfo> {
  const assets = new Map<string, AssetInfo>();
  for (const asset of plan.assets) {
    if (!existsSync(asset.path)) {
      plan.report.assets.missing.push(asset.path);
      continue;
    }
    plan.report.assets.linked++;
    assets.set(asset.ref, {
      id: `dry:${asset.ref}`,
      revision: '1',
      kind: asset.hint.kind,
      width: asset.hint.width,
      height: asset.hint.height,
      durationUs: asset.hint.durationUs,
      hasAudio: asset.hint.hasAudio ?? asset.hint.kind === 'audio',
    });
  }
  return assets;
}

function importOperation(asset: AssetPlan): Record<string, unknown> {
  return {
    type: 'importAsset',
    path: asset.path,
    storage: 'linked',
    ref: asset.ref,
    ...(asset.name ? { name: asset.name } : {}),
    ...(asset.include ? { include: asset.include } : {}),
    ...(asset.bundle ? { bundle: asset.bundle } : {}),
    ...(asset.provenance ? { provenance: asset.provenance } : {}),
  };
}

function summarize(plan: ProjectPlan, content: VideoContent): void {
  const report = plan.report;
  for (const doc of content.documents) count(report.documents, doc.kind);
  report.tracks = content.tracks.length;
  for (const item of content.items) count(report.items, String(item.item.type));
}

export function planContent(plan: ProjectPlan, assets: Map<string, AssetInfo>): VideoContent {
  const content = plan.build(assets);
  summarize(plan, content);
  return content;
}

function importRecord(plan: ProjectPlan): Json {
  const { videoDir: _dir, ...report } = plan.report;
  return JSON.parse(JSON.stringify({ schema: 'baocut.import-record/1', importer: IMPORTER, ...report })) as Json;
}

export async function writeVideo(host: EngineHost, plan: ProjectPlan, root: string, replace: boolean): Promise<void> {
  const report = plan.report;
  const dir = path.join(root, plan.dirName);
  report.videoDir = dir;
  const exists = existsSync(path.join(dir, 'video.db'));
  if (exists && replace) await rm(dir, { recursive: true });
  const opened =
    exists && !replace
      ? await host.request<Opened>('videos.open', { path: dir })
      : await host.request<Opened>('videos.create', { path: dir, name: plan.name, fps: plan.fps, width: plan.width, height: plan.height });
  host.remember(opened.videoId, opened.path);
  const session = new VideoSession(host, opened.videoId);
  try {
    // 1. 素材：一个素材一笔事务，文件不在或探测不了只影响它自己。
    const ids = new Map<string, string>();
    for (const asset of plan.assets) {
      if (!existsSync(asset.path)) {
        report.assets.missing.push(asset.path);
        continue;
      }
      try {
        const receipt = await session.step(`asset:${asset.ref}`, `导入素材 ${path.basename(asset.path)}`, [importOperation(asset)]);
        const id = receipt.refs?.[asset.ref];
        if (!id) throw new Error('回执里没有素材 ID');
        ids.set(asset.ref, id);
        if (receipt.createdIds.includes(id)) report.assets.linked++;
        else report.assets.reused++;
      } catch (error) {
        if (!(error instanceof EngineFailure)) throw error;
        report.failed.push(`素材 ${asset.path}：${error.body.code} ${error.body.message}`);
      }
    }
    let snapshot = await session.snapshot();
    const assets = new Map<string, AssetInfo>();
    for (const asset of plan.assets) {
      const id = ids.get(asset.ref);
      if (!id) continue;
      const info = assetInfo(snapshot.assets[id]);
      assets.set(asset.ref, info);
      if (asset.legacyHash?.startsWith('sha256-') && info.contentHash && !info.contentHash.endsWith(asset.legacyHash.slice(7))) {
        report.assets.hashChanged.push(asset.path);
      }
    }

    const content = planContent(plan, assets);

    // 2. 文档：一份一笔事务（转写正文可以有几 MB）。
    const documents = new Map<string, string>();
    const putDocument = async (doc: VideoContent['documents'][number]): Promise<void> => {
      const sourceAsset = doc.sourceAsset ? assets.get(doc.sourceAsset)?.id : undefined;
      const sourceDocument = doc.sourceDocument ? documents.get(doc.sourceDocument) : undefined;
      const receipt = await session.step(`document:${doc.ref}`, `写入文档 ${doc.name}`, [
        {
          type: 'putDocument',
          ref: doc.ref,
          kind: doc.kind,
          name: doc.name,
          ...(doc.language ? { language: doc.language } : {}),
          ...(sourceAsset ? { sourceAsset: { assetId: sourceAsset } } : {}),
          ...(sourceDocument ? { sourceDocument: { documentId: sourceDocument } } : {}),
          body: doc.body,
          ...(doc.summary ? { summary: doc.summary } : {}),
        },
      ]);
      const id = receipt.refs?.[doc.ref];
      if (!id) throw new Error(`回执里没有文档 ${doc.ref} 的 ID`);
      documents.set(doc.ref, id);
    };
    for (const doc of content.documents) await putDocument(doc);

    // 3. 轨道：新视频自带 V1 与 A1，计划里第一条画面轨与第一条音频轨用它们，其余按顺序新建（越靠后越在上层）。
    const existingTracks = snapshot.sequences[snapshot.rootSequenceId].tracks;
    const trackOps = (): unknown[] => {
      const builtin: Record<string, string | undefined> = {};
      for (const track of existingTracks) builtin[track.kind] ??= track.id;
      const used = new Set<string>();
      return content.tracks.map((track) => {
        const existing = builtin[track.kind];
        if (!existing || used.has(track.kind)) return { type: 'addTrack', kind: track.kind, name: track.name };
        used.add(track.kind);
        return { type: 'updateTrack', trackId: existing, name: track.name };
      });
    };
    if (content.tracks.length > 0) await session.step('tracks', '建立轨道', trackOps, content.tracks);
    snapshot = await session.snapshot();
    const trackIds = new Map<string, string>();
    for (const track of content.tracks) {
      const found = snapshot.sequences[snapshot.rootSequenceId].tracks.find((t) => t.name === track.name && t.kind === track.kind);
      if (!found) throw new Error(`轨道 ${track.name} 没有建成`);
      trackIds.set(track.key, found.id);
    }

    // 4. 实例：先写画面与声音，再写要引用它们的字幕实例。
    const sequenceId = snapshot.rootSequenceId;
    // 词锚点指向转写文档的当前版本。
    const speechId = documents.get('speech');
    const speechRef = speechId ? { id: speechId, revision: snapshot.documents[speechId]?.currentRevision } : null;
    const withSpeechRef = (fields: { [key: string]: Json }, sourceId: string): { [key: string]: Json } => {
      const policy = fields.followPolicy as { kind?: string; start?: { speechRef?: Json }; end?: { speechRef?: Json } } | undefined;
      if (policy?.kind !== 'speech-anchor') return fields;
      if (!speechRef?.revision) {
        const { followPolicy: _policy, ...rest } = fields;
        count(report.dropped, '词锚点（没有转写文档）');
        report.warnings.push(`实例 ${sourceId} 的词锚点找不到转写文档：按序列时间固定`);
        return { ...rest, followPolicy: { kind: 'sequence-fixed' } };
      }
      const anchor = (a: { speechRef?: Json } | undefined) => (a ? { ...a, speechRef } : undefined);
      return { ...fields, followPolicy: JSON.parse(JSON.stringify({ ...policy, start: anchor(policy.start), end: anchor(policy.end) })) };
    };
    const body = (item: ItemPlan, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
      ...withSpeechRef(item.item, item.sourceId),
      ...extra,
      trackId: trackIds.get(item.track),
    });
    const fail = (what: string, error: unknown): void => {
      if (!(error instanceof EngineFailure)) throw error;
      report.failed.push(`${what}：${error.body.code} ${error.body.message}`);
    };
    /** 引擎拒绝了一个实例：逐个去掉可选的字段组再试，找出是哪一组；都不行就只留必需的字段。 */
    const OPTIONAL: [string, (body: Record<string, any>) => Record<string, any> | null][] = [
      ...['fx', 'mask', 'tile', 'animate', 'crop', 'style', 'stylePresetId', 'verticalAlign', 'role', 'ai', 'bg', 'source', 'html'].map(
        (key): [string, (b: Record<string, any>) => Record<string, any> | null] => [
          key,
          (b) => {
            if (b[key] == null) return null;
            const { [key]: _gone, ...rest } = b;
            return rest;
          },
        ],
      ),
      [
        'envelope',
        (b) => {
          const holder = b.mix ? 'mix' : b.embeddedAudio ? 'embeddedAudio' : b.audio ? 'audio' : null;
          if (!holder || b[holder].envelope == null) return null;
          const { envelope: _gone, ...rest } = b[holder];
          return { ...b, [holder]: rest };
        },
      ],
      [
        'followPolicy',
        (b) =>
          b.followPolicy == null && b.untilSequenceEnd == null ? null : (({ followPolicy: _f, untilSequenceEnd: _u, ...rest }) => rest)(b),
      ],
      ['place', (b) => (b.place == null || Object.keys(b.place).length === 0 ? null : { ...b, place: {} })],
    ];
    const insertOne = async (command: string, label: string, item: { plan: ItemPlan; body: Record<string, unknown> }): Promise<boolean> => {
      const what = `实例 ${item.plan.sourceId}（${String(item.plan.item.type)}）`;
      let first: unknown;
      try {
        await session.step(command, label, [{ type: 'insertItems', sequenceId, items: [item.body] }]);
        return true;
      } catch (error) {
        if (!(error instanceof EngineFailure)) throw error;
        first = error;
      }
      const candidates = OPTIONAL.map(([group, strip]) => [group, strip(item.body)] as const).filter(([, b]) => b != null);
      for (const [group, stripped] of candidates) {
        try {
          await session.step(`${command}:-${group}`, `${label}（去掉 ${group}）`, [{ type: 'insertItems', sequenceId, items: [stripped] }]);
          count(report.dropped, group);
          report.warnings.push(`${what} 的 ${group} 引擎不接受，去掉之后导入：${(first as EngineFailure).body.message}`);
          return true;
        } catch (error) {
          if (!(error instanceof EngineFailure)) throw error;
        }
      }
      const bare = candidates.reduce<Record<string, any>>((b, [group]) => OPTIONAL.find(([g]) => g === group)?.[1](b) ?? b, item.body);
      if (candidates.length > 1) {
        try {
          await session.step(`${command}:-all`, `${label}（只留必需字段）`, [{ type: 'insertItems', sequenceId, items: [bare] }]);
          for (const [group] of candidates) count(report.dropped, group);
          report.warnings.push(
            `${what} 引擎不接受，去掉 ${candidates.map(([g]) => g).join('、')} 之后导入：${(first as EngineFailure).body.message}`,
          );
          return true;
        } catch (error) {
          if (!(error instanceof EngineFailure)) throw error;
        }
      }
      fail(what, first);
      count(report.items, String(item.plan.item.type), -1);
      return false;
    };
    const insert = async (command: string, label: string, items: { plan: ItemPlan; body: Record<string, unknown> }[]): Promise<void> => {
      if (items.length === 0) return;
      // 上次已经逐个写过（整批被拒）：这次也逐个写，免得整批再写一遍。
      const split = await session.committed(`${command}:0`);
      if (!split) {
        try {
          await session.step(command, label, [{ type: 'insertItems', sequenceId, items: items.map((i) => i.body) }]);
          return;
        } catch (error) {
          if (!(error instanceof EngineFailure)) throw error;
        }
      }
      // 整批被拒：逐个写，找出是哪一个，其余照常导入。
      for (const [n, item] of items.entries()) await insertOne(`${command}:${n}`, `${label} ${item.plan.sourceId}`, item);
    };
    const plain = content.items.filter((item) => item.item.type !== 'caption');
    await insert(
      'items',
      '写入实例',
      plain.map((plan) => ({ plan, body: body(plan) })),
    );
    snapshot = await session.snapshot();
    const itemIds = new Map<string, string>();
    for (const item of snapshot.sequences[sequenceId].items) {
      const sourceId = item.extensions?.['baocut.import']?.sourceId;
      if (sourceId) itemIds.set(sourceId, item.id);
    }
    const mapIds = (sourceIds: string[] | undefined): string[] =>
      (sourceIds ?? []).map((id) => itemIds.get(id)).filter((id): id is string => !!id);
    const captions = content.items
      .filter((item) => item.item.type === 'caption')
      .map((plan) => {
        const documentId = plan.document ? documents.get(plan.document) : undefined;
        const styleDocumentId = plan.styleDocument ? documents.get(plan.styleDocument) : undefined;
        const scopeItemIds = mapIds(plan.scopeSourceIds);
        return {
          plan,
          body: body(plan, {
            documentId,
            ...(styleDocumentId ? { styleDocumentId } : {}),
            ...(scopeItemIds.length ? { scopeItemIds } : {}),
          }),
        };
      });
    await insert('captions', '写入字幕实例', captions);

    /** 序列上的对象：先整批写，被拒时逐个写，拒掉的记进报告。返回写进去的个数。 */
    const batch = async (
      command: string,
      label: string,
      ops: { key: string; what: string; drop: string; op: unknown }[],
    ): Promise<number> => {
      if (ops.length === 0) return 0;
      if (!(await session.committed(`${command}:${ops[0].key}`))) {
        try {
          await session.step(
            command,
            label,
            ops.map((o) => o.op),
          );
          return ops.length;
        } catch (error) {
          if (!(error instanceof EngineFailure)) throw error;
        }
      }
      let done = 0;
      for (const o of ops) {
        try {
          await session.step(`${command}:${o.key}`, `${label} ${o.key}`, [o.op]);
          done++;
        } catch (error) {
          if (!(error instanceof EngineFailure)) throw error;
          count(report.dropped, o.drop);
          report.warnings.push(`${o.what} 引擎不接受，没有带过来：${error.body.message}`);
        }
      }
      return done;
    };
    const written = (label: string, n: number): void => {
      if (n > 0) count(report.written, label, n);
    };

    // 5. 关键帧：每个实例的每个属性一条绑定。
    const keyframeOps = plain.flatMap((plan) => {
      const itemId = itemIds.get(plan.sourceId);
      if (!itemId) return [];
      return (plan.keyframes ?? []).map((k) => ({
        key: `${plan.sourceId}:${k.property}`,
        what: `实例 ${plan.sourceId} 的 ${k.property} 关键帧`,
        drop: `关键帧 ${k.property}`,
        op: { type: 'setKeyframes', sequenceId, itemId, property: k.property, keyframes: k.keyframes },
      }));
    });
    written('关键帧绑定', await batch('keyframes', '写入关键帧', keyframeOps));

    // 6. 单侧转场：`in` 落在实例开头，`out` 落在结尾；一条一笔事务，好从回执里认出被缩短的那条。
    for (const plan of plain) {
      const itemId = itemIds.get(plan.sourceId);
      if (!itemId) continue;
      for (const t of plan.transitions ?? []) {
        try {
          const receipt = await session.step(`transition:${plan.sourceId}:${t.side}`, `写入转场 ${plan.sourceId} ${t.side}`, [
            {
              type: 'setTransition',
              sequenceId,
              ...(t.side === 'in' ? { rightItemId: itemId } : { leftItemId: itemId }),
              kind: t.kind,
              duration: { unit: 'seconds', value: t.duration },
              alignment: 'nearest-frame',
            },
          ]);
          count(report.written, '单侧转场');
          for (const s of receipt.impact?.shortenedTransitions ?? []) {
            report.shortenedTransitions.push({
              sourceId: plan.sourceId,
              side: t.side,
              durationFrames: s.durationFrames,
              effectiveFrames: s.effectiveFrames,
            });
          }
        } catch (error) {
          if (!(error instanceof EngineFailure)) throw error;
          count(report.dropped, '转场');
          report.warnings.push(`实例 ${plan.sourceId} 的 ${t.side} 转场引擎不接受，没有带过来：${error.body.message}`);
        }
      }
    }

    // 7. 闪避：按文稿，或按旧轨道拆出来的新轨道。
    const duckOps = (content.ducking ?? []).flatMap((rule, n) => {
      const itemIdsOf = mapIds(rule.targetSourceIds);
      if (itemIdsOf.length === 0) return [];
      let trigger: Json = { kind: 'speech' };
      if (rule.trigger.kind === 'tracks') {
        const keys = content.legacyTracks?.[rule.trigger.legacyTrack] ?? [];
        const ids = keys.map((key) => trackIds.get(key)).filter((id): id is string => !!id);
        if (ids.length === 0) {
          count(report.dropped, '闪避');
          report.warnings.push(
            `闪避的触发轨道 ${rule.trigger.legacyTrack} 上没有导入任何实例：${rule.targetSourceIds.join('、')} 的闪避没有带过来`,
          );
          return [];
        }
        trigger = { kind: 'items', trackIds: ids, itemIds: [] };
      }
      return [
        {
          key: String(n),
          what: `闪避（${rule.targetSourceIds.join('、')}）`,
          drop: '闪避',
          op: {
            type: 'setDucking',
            sequenceId,
            trigger,
            target: { trackIds: [], itemIds: itemIdsOf },
            ...(rule.depth != null ? { depth: rule.depth } : {}),
            ...(rule.attack != null ? { attack: rule.attack } : {}),
            ...(rule.release != null ? { release: rule.release } : {}),
          },
        },
      ];
    });
    written('闪避规则', await batch('ducking', '写入闪避', duckOps));

    // 8. 剪口集合：作用实例写好之后才知道 ID。
    for (const set of content.cutSets ?? []) {
      try {
        await putDocument({
          ref: set.ref,
          kind: 'cut-set',
          name: set.name,
          sourceAsset: set.sourceAsset,
          body: { ...set.body, scopeItemIds: mapIds(set.scopeSourceIds) },
          summary: { cutCount: (set.body.cuts as Json[]).length },
        });
        count(report.documents, 'cut-set');
        count(report.written, '剪口集合');
      } catch (error) {
        fail(`剪口集合 ${set.ref}`, error);
      }
    }

    // 9. 模板层与画布底色。
    if (content.template) {
      const op = { type: 'setTemplate', sequenceId, template: content.template };
      written('模板层', await batch('template', '写入模板层', [{ key: 'layers', what: '模板层', drop: '模板层', op }]));
    }
    if (content.background) {
      const op = { type: 'updateSequence', sequenceId, background: content.background };
      written(
        '画布底色',
        await batch('background', '写入画布底色', [{ key: 'color', what: `画布底色 ${content.background}`, drop: '画布底色', op }]),
      );
    }

    // 10. 轨道的隐藏、静音与锁定：锁定挡住之后的写入，放在最后。
    const flagOps = content.tracks.flatMap((track) => {
      const trackId = trackIds.get(track.key);
      if (!trackId || (!track.hidden && !track.muted)) return [];
      return [{ type: 'updateTrack', trackId, ...(track.hidden ? { visible: false } : {}), ...(track.muted ? { muted: true } : {}) }];
    });
    if (flagOps.length > 0) await session.step('track-flags', '设置轨道的隐藏与静音', flagOps);
    const lockOps = content.tracks.flatMap((track) => {
      const trackId = trackIds.get(track.key);
      return trackId && track.locked ? [{ type: 'updateTrack', trackId, locked: true }] : [];
    });

    // 11. 导入记录：这个视频从哪里来、哪些没有带过来。
    const inspected = await host.request<{ durationFrames: number }>('videos.inspect', { path: opened.path });
    report.durationFrames = inspected.durationFrames;
    await putDocument({ ref: 'import-record', kind: 'import-record', name: '导入记录', body: importRecord(plan) });
    report.documents['import-record'] = 1;
    if (lockOps.length > 0) await session.step('track-locks', '锁定轨道', lockOps);
    report.revision = (await session.snapshot()).revision;
  } finally {
    await host.request('videos.close', { videoId: opened.videoId });
  }
}
