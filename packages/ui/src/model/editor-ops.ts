import {
  defineMessages,
  live,
  itemAssetRefs,
  itemTimeMap,
  mediaTimeToSeconds,
  type ArrangeDirection,
  type AssetRecord,
  type DocumentRecord,
  type EditOperation,
  type Id,
  type Sequence,
  type SequenceItem,
  type SequenceItemInput,
  type Track,
} from '@baocut/protocol';
import { languageName } from './caption-tracks.ts';
import { DUB_EXTENSION } from './dub-undo.ts';
import { itemFrames, trackAccepts, trackRows } from './editor.ts';
import { zhHans } from './editor-ops.zh-Hans.ts';
import { zhHant } from './editor-ops.zh-Hant.ts';
import { ja } from './editor-ops.ja.ts';
import { ko } from './editor-ops.ko.ts';
import { es } from './editor-ops.es.ts';
import { fr } from './editor-ops.fr.ts';
import { de } from './editor-ops.de.ts';
import { nl } from './editor-ops.nl.ts';
import { ptBR } from './editor-ops.pt-BR.ts';
import { it } from './editor-ops.it.ts';
import { ru } from './editor-ops.ru.ts';
import { pl } from './editor-ops.pl.ts';
import { tr } from './editor-ops.tr.ts';
import { vi } from './editor-ops.vi.ts';

type DubStatus = 'failed' | 'needs-fit' | 'stale' | 'draft';
const sentencesEn = (n: number) => (n === 1 ? '1 sentence' : `${n} sentences`);
const filesEn = (n: number) => (n === 1 ? '1 file' : `${n} files`);

/** 编辑操作与配音分组卡片的文案（英文是键与类型的来源，译文在 `editor-ops.zh-Hans.ts`）。 */
const en = {
  dubStatus: {
    failed: 'Not synthesized',
    'needs-fit': 'Too long',
    stale: 'Translation outdated',
    draft: 'Not placed',
  } as Record<DubStatus, string>,
  dubStatusCount: (n: number, status: DubStatus) =>
    `${sentencesEn(n)} ${{ failed: 'not synthesized', 'needs-fit': 'too long', stale: 'with outdated translation', draft: 'not placed' }[status]}`,
  stemVocals: 'Separated vocals',
  stemBackground: 'Separated background',
  background: 'Background',
  sentenceN: (n: number) => `Sentence ${n}`,
  dub: 'Voice-over',
  files: filesEn,
  sentences: sentencesEn,
  muted: (n: number) => `${sentencesEn(n)} muted`,
  dubTitle: (language: string | null) => `Voice-over · ${language ?? 'Unknown language'}`,
  aside: (groups: number, files: number) =>
    groups ? `${groups === 1 ? '1 voice-over group' : `${groups} voice-over groups`} · ${filesEn(files)}` : filesEn(files),
};
export type EditorOpsMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 编辑器里手工操作对应的引擎操作（命令与协议规范 §4.2）。拖动与拆分按帧提交（落点就在帧上，不再量化）；
 * 输入框里打的秒数按十进制字符串提交，由引擎量化并在回执里给出实际落点（产品设计 §5.8）。
 */

const frames = (value: number) => ({ unit: 'frames' as const, value: Math.max(0, Math.round(value)) });

/** 图片放上时间线的默认长度（与引擎一致）。 */
const IMAGE_SECONDS = 5;

export type PlaceableKind = 'video' | 'image' | 'audio';

export function isPlaceable(asset: AssetRecord): asset is AssetRecord & { kind: PlaceableKind } {
  return asset.kind === 'video' || asset.kind === 'image' || asset.kind === 'audio';
}

/** 素材库里某一类的素材，按名字排（素材面板的图片、视频、音频各一页）。 */
export function libraryAssets<K extends PlaceableKind>(assets: Record<Id, AssetRecord>, kind: K): (AssetRecord & { kind: K })[] {
  return Object.values(assets)
    .filter((asset): asset is AssetRecord & { kind: K } => asset.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

/** 素材放上时间线大约占多少帧（判断放不放得下用；实际长度以引擎为准）。 */
export function assetFrames(asset: AssetRecord, sequence: Sequence): number {
  const revision = asset.revisions[asset.currentRevision];
  const seconds = asset.kind === 'image' || !revision?.duration ? IMAGE_SECONDS : mediaTimeToSeconds(revision.duration);
  return Math.max(1, Math.floor((seconds * sequence.fps.num) / sequence.fps.den));
}

/** 这条轨道在 [start, end) 帧之间空着吗（不算 `ignore` 里的实例）。 */
export function trackFree(sequence: Sequence, trackId: Id, start: number, end: number, ignore: ReadonlySet<Id> = new Set()): boolean {
  return sequence.items.every((item) => {
    if (item.trackId !== trackId || ignore.has(item.id)) return true;
    const range = itemFrames(item, sequence.fps);
    return range.end <= start + 1e-6 || range.start >= end - 1e-6;
  });
}

function unlockedTracks(sequence: Sequence, kind: PlaceableKind): Track[] {
  return [...sequence.tracks]
    .filter((track) => !track.locked && trackAccepts(track, { type: kind }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * 「添加到时间线」：放在播放头处（原型 editor-elements.jsx `addElement`：从面板加的东西是播放头处的一层）。
 * - 图片、视频要压在画面最上面才看得见：只用这段时间里有东西的最上面一条视觉轨之上的空轨；没有就在最上面新建一条
 *   （`addItem` 不能引用同一事务里新建的轨道，所以按引擎 `addItem` 的缺省字段用 `insertItems` 写入）。
 * - 音频放进第一条在那里空着的音频轨；都被占了就接在第一条音频轨的末尾。
 * - 指定了轨道（拖到某一行上）时只看那一条：空着就放在落点，否则接在它末尾。
 */
export function placeAsset(sequence: Sequence, asset: AssetRecord & { kind: PlaceableKind }, atFrame: number, trackId?: Id): EditOperation[] {
  const length = assetFrames(asset, sequence);
  const base = { type: 'addItem' as const, sequenceId: sequence.id, asset: { assetId: asset.id }, alignment: 'exact-frame' as const };
  const candidates = unlockedTracks(sequence, asset.kind).filter((track) => !trackId || track.id === trackId);
  const free = (tracks: Track[]) => tracks.find((track) => trackFree(sequence, track.id, atFrame, atFrame + length));
  if (trackId || asset.kind === 'audio') {
    const open = free(candidates);
    if (open) return [{ ...base, trackId: open.id, at: frames(atFrame) }];
    const fallback = candidates[0];
    return [fallback ? { ...base, trackId: fallback.id } : base];
  }
  const busy = sequence.tracks.filter((track) => track.kind === 'visual' && !trackFree(sequence, track.id, atFrame, atFrame + length));
  const floor = busy.length ? Math.max(...busy.map((track) => track.order)) : Number.NEGATIVE_INFINITY;
  const open = free(candidates.filter((track) => track.order > floor && track.visible));
  if (open) return [{ ...base, trackId: open.id, at: frames(atFrame) }];
  const ref = 'place-track';
  return [
    { type: 'addTrack', sequenceId: sequence.id, kind: 'visual', ref },
    { type: 'insertItems', sequenceId: sequence.id, items: [overlayItem(sequence, asset, atFrame, ref)] },
  ];
}

/** 与引擎 `addItem` 缺省相同的一层图片或视频：铺满画布（`fullscreen` + `contain`）、不透明、从素材开头起；图片 5 秒，视频取整帧的全长。 */
function overlayItem(sequence: Sequence, asset: AssetRecord & { kind: PlaceableKind }, atFrame: number, trackRef: string): SequenceItemInput {
  const perSecond = sequence.fps.num / sequence.fps.den;
  const duration = asset.revisions[asset.currentRevision]?.duration;
  const common = {
    trackRef,
    name: asset.name,
    place: {},
    assetRef: { id: asset.id, revision: asset.currentRevision },
    mode: 'fullscreen' as const,
    fit: 'contain' as const,
  };
  const from = Math.max(0, Math.round(atFrame));
  if (asset.kind === 'image' || !duration) {
    return { ...common, type: 'image', span: { fromFrame: from, durationFrames: Math.max(1, Math.round(IMAGE_SECONDS * perSecond)) } };
  }
  return {
    ...common,
    type: 'video',
    span: { fromFrame: from, durationFrames: Math.max(1, Math.floor(mediaTimeToSeconds(duration) * perSecond)) },
    timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: duration.timescale }, rate: { num: 1, den: 1 } },
    embeddedAudio: { enabled: true, volume: 1 },
  };
}

/**
 * 从电脑里拖进来的文件：导入与放置在同一笔事务里（导入用 ref 让后面的放置引用）。导入方知道素材名与来源时一并带上
 * （首页链接导入下载的文件记 `link-import` 的来源）。
 */
export function importAndPlace(
  sequence: Sequence,
  files: readonly { path: string; kind: PlaceableKind | null; name?: string; provenance?: { origin: string; source?: unknown } }[],
  atFrame: number | null,
  trackId?: Id,
): EditOperation[] {
  const operations: EditOperation[] = [];
  files.forEach((file, index) => {
    const ref = `drop${index}`;
    operations.push({
      type: 'importAsset',
      path: file.path,
      ref,
      ...(file.name ? { name: file.name } : {}),
      ...(file.provenance ? { provenance: file.provenance } : {}),
    });
    if (!file.kind) return;
    const track = trackId ? sequence.tracks.find((t) => t.id === trackId) : undefined;
    const fits = track && !track.locked && trackAccepts(track, { type: file.kind });
    // 第一个文件放在落点，之后的接在同一条轨道末尾，不叠在一起。
    operations.push({
      type: 'addItem',
      sequenceId: sequence.id,
      asset: { ref },
      ...(fits ? { trackId: track.id } : {}),
      ...(index === 0 && atFrame !== null && fits ? { at: frames(atFrame) } : {}),
      alignment: 'exact-frame',
    });
  });
  return operations;
}

export interface DragMove {
  /** 被抓住的实例。 */
  itemId: Id;
  /** 一起移动的实例（含被抓住的那个）。 */
  itemIds: Id[];
  /** 移动了多少帧。 */
  deltaFrames: number;
  /** 被抓住的实例换到的轨道；不换轨道时为 null。只有单个实例时才换轨道。 */
  trackId: Id | null;
}

/** 拖动：一个实例用 moveItem（可以换轨道），多个一起用 moveItems（同一笔事务，重叠在全部移动之后检查）。 */
export function moveOperation(sequence: Sequence, drag: DragMove): EditOperation | null {
  const byId = new Map(sequence.items.map((item) => [item.id, item]));
  const moved = drag.itemIds.map((id) => byId.get(id)).filter((item): item is SequenceItem => !!item);
  if (!moved.length) return null;
  const changeTrack = drag.trackId !== null && moved.length === 1 && drag.trackId !== moved[0]!.trackId;
  if (drag.deltaFrames === 0 && !changeTrack) return null;
  const startOf = (item: SequenceItem) => itemFrames(item, sequence.fps).start;
  if (moved.length === 1) {
    const item = moved[0]!;
    return {
      type: 'moveItem',
      sequenceId: sequence.id,
      itemId: item.id,
      at: frames(startOf(item) + drag.deltaFrames),
      ...(changeTrack ? { trackId: drag.trackId! } : {}),
      alignment: 'exact-frame',
    };
  }
  return {
    type: 'moveItems',
    sequenceId: sequence.id,
    moves: moved.map((item) => ({ itemId: item.id, at: frames(startOf(item) + drag.deltaFrames) })),
    alignment: 'exact-frame',
  };
}

/** 裁切一端到某一帧。至少留一帧；不合理时返回 null。 */
export function trimOperation(sequence: Sequence, item: SequenceItem, edge: 'start' | 'end', frame: number): EditOperation | null {
  const range = itemFrames(item, sequence.fps);
  const target = Math.round(frame);
  if (edge === 'start' && (target >= Math.ceil(range.end) || target === Math.round(range.start))) return null;
  if (edge === 'end' && (target <= Math.floor(range.start) || target === Math.round(range.end))) return null;
  return { type: 'trimItem', sequenceId: sequence.id, itemId: item.id, edge, at: frames(target), alignment: 'exact-frame' };
}

/** 在播放头处拆分：选中的实例里跨过播放头的；没有选中时拆所有跨过播放头、没有锁定的实例。 */
export function splitOperations(sequence: Sequence, selection: readonly Id[], playheadFrame: number): EditOperation[] {
  const locked = new Set(sequence.tracks.filter((t) => t.locked).map((t) => t.id));
  const pool = selection.length ? sequence.items.filter((item) => selection.includes(item.id)) : sequence.items;
  return pool
    .filter((item) => !item.locked && !locked.has(item.trackId))
    .filter((item) => {
      const range = itemFrames(item, sequence.fps);
      return range.start < playheadFrame - 1e-6 && range.end > playheadFrame + 1e-6;
    })
    .map((item) => ({ type: 'splitItem', sequenceId: sequence.id, itemId: item.id, at: frames(playheadFrame), alignment: 'exact-frame' }));
}

/**
 * Delete 删除的片段：选区里还在时间线上的实例（按时间线上的次序）。没有就没有可删的，走带的删除键置灰。
 * 锁定不在这里拦（与 Delete 键一致，由引擎判）。
 */
export function deletableItemIds(sequence: Sequence, selection: readonly Id[]): Id[] {
  if (!selection.length) return [];
  const ids = new Set(selection);
  return sequence.items.filter((item) => ids.has(item.id)).map((item) => item.id);
}

/** 素材在时间线上用了几次（合成的预渲染替身也算）。 */
export function usageCount(sequence: Sequence | null, assetId: Id): number {
  return sequence ? sequence.items.filter((item) => itemAssetRefs(item).some((ref) => ref.id === assetId)).length : 0;
}

/**
 * 裁切能拉到哪里（帧）：开始端不早于素材的开头，结束端不晚于素材的结尾，两端至少隔一帧。
 * 没有源时间的实例（图片、文字、图形、字幕）没有长度限制。合成的结尾只受预渲染替身的长度限制（代码包本身没有时长），
 * 没有替身时只有开头的限制。只是界面上的限制，越界时引擎同样会拒绝。
 */
export function trimBounds(item: SequenceItem, assets: Record<Id, AssetRecord>, sequence: Sequence): { min: number; max: number } {
  const { start, end } = itemFrames(item, sequence.fps);
  const perSecond = sequence.fps.num / sequence.fps.den;
  const timeMap = itemTimeMap(item);
  if (timeMap?.kind !== 'linear') return { min: 0, max: Number.POSITIVE_INFINITY };
  const rate = timeMap.rate.num / timeMap.rate.den;
  const sourceIn = mediaTimeToSeconds(timeMap.sourceIn);
  const timed = item.type === 'composition' ? item.prerender : item.type === 'video' || item.type === 'audio' ? item.assetRef : undefined;
  const revision = timed ? assets[timed.id]?.revisions[timed.revision] : undefined;
  const duration = revision?.duration ? mediaTimeToSeconds(revision.duration) : null;
  const min = Math.max(0, Math.ceil(start - (sourceIn / rate) * perSecond - 1e-6));
  const max = duration === null ? Number.POSITIVE_INFINITY : Math.floor(start + ((duration - sourceIn) / rate) * perSecond + 1e-6);
  return { min, max: Math.max(max, Math.ceil(end)) };
}

/** ⌘A：时段覆盖播放头那一帧的片段（原型 visibleAt：播放头下的元素）。 */
export function itemsAtFrame(sequence: Sequence, frame: number): Id[] {
  return sequence.items
    .filter((item) => {
      const { start, end } = itemFrames(item, sequence.fps);
      return start <= frame + 1e-6 && end > frame + 1e-6;
    })
    .map((item) => item.id);
}

/**
 * ⌥←/→ 微调时间的一步：选中的片段整体再挪 `step` 帧之后，起点不早于 0、不撞到同轨道上没选中的片段，
 * 就返回新的累计偏移；挪不动（或有锁住的）时原样返回。`delta` 是还没提交的那段累计偏移。
 */
export function nudgeDelta(sequence: Sequence, itemIds: readonly Id[], delta: number, step: number): number {
  const ids = new Set(itemIds);
  const moved = sequence.items.filter((item) => ids.has(item.id));
  if (!moved.length || step === 0) return delta;
  const locked = new Set(sequence.tracks.filter((track) => track.locked).map((track) => track.id));
  if (moved.some((item) => item.locked || locked.has(item.trackId))) return delta;
  const next = delta + step;
  const fps = sequence.fps;
  for (const item of moved) {
    const { start, end } = itemFrames(item, fps);
    if (start + next < -1e-6) return delta;
    const blocked = sequence.items.some((other) => {
      if (other.trackId !== item.trackId || ids.has(other.id)) return false;
      const range = itemFrames(other, fps);
      return range.end > start + next + 1e-6 && range.start < end + next - 1e-6;
    });
    if (blocked) return delta;
  }
  return next;
}

// ---- 素材面板的 ⋯ 菜单与配音组（设计稿 panel-media.jsx `MediaMenu`、`AudioGroup`）----

/** 素材在时间线上的一处用法（「用在哪」）。 */
export interface AssetUsage {
  itemId: Id;
  /** 轨道行头上的名字（与时间线一致）。 */
  track: string;
  name: string;
  /** 起止（秒）。 */
  start: number;
  end: number;
}

/** 素材用在时间线的哪里：按起点排，带轨道名；合成的预渲染替身也算。 */
export function assetUsages(sequence: Sequence | null, assetId: Id): AssetUsage[] {
  if (!sequence) return [];
  const labels = new Map(trackRows(sequence).map((row) => [row.track.id, row.label]));
  const perSecond = sequence.fps.num / sequence.fps.den;
  return sequence.items
    .filter((item) => itemAssetRefs(item).some((ref) => ref.id === assetId))
    .map((item) => {
      const range = itemFrames(item, sequence.fps);
      return { itemId: item.id, track: labels.get(item.trackId) ?? '', name: item.name ?? '', start: range.start / perSecond, end: range.end / perSecond };
    })
    .sort((a, b) => a.start - b.start || a.itemId.localeCompare(b.itemId));
}

/**
 * 「在文件夹中显示」的文件：链接的素材是登记的原文件（相对路径接在视频目录后面）。收进视频目录的素材由 BaoCut 管理，
 * Runtime 不给出它在磁盘上的位置（同 library-brand 的说法），返回 null。
 */
export function assetFilePath(asset: AssetRecord, videoDir: string | null): string | null {
  const storage = asset.revisions[asset.currentRevision]?.storage;
  if (storage?.mode !== 'linked') return null;
  const path = storage.locator.path;
  // 绝对路径：macOS / Linux 的 `/…`，Windows 的 `C:\…` 或 `\\server\…`（同 tools-transcode 的 isAbsolutePath）。
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')) return path;
  if (!videoDir) return null;
  const windows = /^[A-Za-z]:\\/.test(videoDir) || videoDir.startsWith('\\\\');
  // 链到视频目录外的（`../downloads/a.webm`）折掉 `.` 与 `..`，显示与交给文件管理器的都是干净的路径。
  const sep = windows ? '\\' : '/';
  const parts = videoDir.replace(/[\\/]+$/, '').split(/[\\/]/);
  // 不越过根：`/`（分出来是空串）、`C:`，或 UNC 的 `\\server\share`。
  const root = videoDir.startsWith('\\\\') ? 4 : 1;
  for (const segment of path.split(/[\\/]+/)) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (parts.length > root) parts.pop();
    } else parts.push(segment);
  }
  return parts.length === 1 ? `${parts[0]}${sep}` : parts.join(sep);
}

/** 配音组里的一行文件（设计稿 `.agfile`）：分离出的背景声（与人声）各一行，每句一行；没合成、过长、译文过期的句没有实例，也列出来。 */
export interface DubFileRow {
  key: string;
  kind: 'bed' | 'sentence';
  /** 时间线上的实例：点一行选中它、跳过去。没放上时间线的为 null。 */
  itemId: Id | null;
  name: string;
  /** 这一句的译文；分轨写「分离出来的背景声」或「分离出来的人声」。 */
  text: string;
  status: 'failed' | 'needs-fit' | 'stale' | 'draft' | null;
  muted: boolean;
  /** 时长（秒）；没有实例也不知道素材时长时为 null。 */
  seconds: number | null;
}

export interface DubGroupCard {
  groupId: string;
  language: string | null;
  /** 行头小牌：语言子标签（EN、JA）；不知道语言时写「配音」。 */
  badge: string;
  /** 「配音 · English」。 */
  title: string;
  /** 组头副题：`63 个文件 · 62 句 · 3 句没合成 · 模型`。 */
  line: string;
  /** 已在时间线 / 轨已关 / 不在时间线（实例都删了，素材还在库里）。 */
  state: 'on' | 'off' | 'gone';
  files: DubFileRow[];
  /** 配音轨（「移除这组配音」去掉以它为触发的闪避）。 */
  trackId: Id | null;
  /** 时间线上这一组的实例（含分离出来的背景）。 */
  itemIds: Id[];
  /** 需要重新生成的句：没合成的与过长的。 */
  regen: number;
}

export const DUB_STATUS_TEXT: Record<NonNullable<DubFileRow['status']>, string> = live(() => M.dubStatus);

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const dubMark = (extensions: Record<string, unknown> | undefined): (Json & { groupId: string }) | null => {
  const mark = extensions?.[DUB_EXTENSION];
  return isJson(mark) && typeof mark.groupId === 'string' ? (mark as Json & { groupId: string }) : null;
};

/** 配音流程生成的素材属于哪一组：`groupId` 由流程按任务 ID 起（`dub_<任务>`）。 */
function dubGroupOfAsset(asset: AssetRecord): { groupId: string; language: string | null; stem: string | null } | null {
  const source = asset.revisions[asset.currentRevision]?.provenance.source;
  if (!isJson(source) || source.pipeline !== 'dub' || typeof source.jobId !== 'string') return null;
  return {
    groupId: `dub_${source.jobId.replace(/^job_/, '')}`,
    language: typeof source.language === 'string' ? source.language : null,
    stem: typeof source.stem === 'string' ? source.stem : null,
  };
}

/** 配音计划文档：当前版本的概要记着 `groupId`。 */
export function dubPlanRecord(documents: Record<Id, DocumentRecord>, groupId: string): DocumentRecord | undefined {
  return Object.values(documents).find((record) => {
    if (record.kind !== 'dubbing-plan') return false;
    const summary = record.revisions[record.currentRevision]?.summary;
    return isJson(summary) && summary.groupId === groupId;
  });
}

/**
 * 音频页按配音分组（设计稿 `audioGroups`）：时间线上带 `extensions['baocut.dub']` 的实例与配音流程生成的素材，一组一张卡；
 * 剩下的音频素材照旧平铺（`loose`）。组的顺序按第一次出现（时间线上的在前）。
 */
export function dubGroupIds<A extends AssetRecord>(sequence: Sequence | null, assets: readonly A[]): { groups: string[]; loose: A[] } {
  const groups: string[] = [];
  const grouped = new Set<Id>();
  const add = (groupId: string) => {
    if (!groups.includes(groupId)) groups.push(groupId);
  };
  for (const item of sequence?.items ?? []) {
    const mark = dubMark(item.extensions);
    if (!mark) continue;
    add(mark.groupId);
    for (const ref of itemAssetRefs(item)) grouped.add(ref.id);
  }
  for (const asset of assets) {
    const own = dubGroupOfAsset(asset);
    if (!own) continue;
    add(own.groupId);
    grouped.add(asset.id);
  }
  return { groups, loose: assets.filter((asset) => !grouped.has(asset.id)) };
}

interface PlanUnit {
  unitId: string;
  index: number;
  text: string;
  status: string;
}

function planUnits(body: unknown): PlanUnit[] | null {
  if (!isJson(body) || !Array.isArray(body.units)) return null;
  const out: PlanUnit[] = [];
  body.units.forEach((unit: unknown, index: number) => {
    if (!isJson(unit)) return;
    const own = isJson(unit.extensions) ? unit.extensions[DUB_EXTENSION] : undefined;
    const unitId =
      isJson(own) && typeof own.translationUnitId === 'string' ? own.translationUnitId : typeof unit.id === 'string' ? unit.id.replace(/^d-/, '') : null;
    if (!unitId) return;
    const text = isJson(unit.script) && typeof unit.script.text === 'string' ? unit.script.text : '';
    out.push({ unitId, index, text, status: typeof unit.status === 'string' ? unit.status : 'ready' });
  });
  return out;
}

/** 配音用的模型（计划正文 `extensions['baocut.dub'].voice`）。 */
function planEngine(body: unknown): string | null {
  if (!isJson(body) || !isJson(body.extensions)) return null;
  const own = body.extensions[DUB_EXTENSION];
  const voice = isJson(own) && isJson(own.voice) ? own.voice : null;
  if (!voice) return null;
  return typeof voice.modelId === 'string' && voice.modelId
    ? voice.modelId
    : typeof voice.providerId === 'string' && voice.providerId
      ? voice.providerId
      : null;
}

/** 一组配音的卡片（设计稿 `audioGroups` 的一组与 `groupLine`）。`planBody` 是配音计划的正文，还没取到时给 undefined。 */
export function dubGroupCard(sequence: Sequence | null, assets: Record<Id, AssetRecord>, groupId: string, planBody: unknown): DubGroupCard {
  const fps = sequence?.fps ?? { num: 30, den: 1 };
  const perSecond = fps.num / fps.den;
  const items = (sequence?.items ?? [])
    .map((item) => ({ item, mark: dubMark(item.extensions), range: itemFrames(item, fps) }))
    .filter(
      (entry): entry is { item: SequenceItem; mark: Json & { groupId: string }; range: { start: number; end: number } } => entry.mark?.groupId === groupId,
    )
    .sort((a, b) => a.range.start - b.range.start || a.item.id.localeCompare(b.item.id));
  const sentences = items.filter((entry) => entry.mark.stem === undefined);
  const beds = items.filter((entry) => entry.mark.stem !== undefined);
  const owned = Object.values(assets).filter((asset) => dubGroupOfAsset(asset)?.groupId === groupId);
  const language =
    sentences.map((e) => e.mark.language).find((l): l is string => typeof l === 'string') ??
    owned.map((a) => dubGroupOfAsset(a)!.language).find((l): l is string => l !== null) ??
    null;

  const assetOf = (item: SequenceItem) => itemAssetRefs(item)[0]?.id ?? null;
  const secondsOf = (asset: AssetRecord | undefined) => {
    const duration = asset?.revisions[asset.currentRevision]?.duration;
    return duration ? mediaTimeToSeconds(duration) : null;
  };
  const silent = (item: SequenceItem) => !item.enabled || (item.type === 'audio' && item.mix.muted === true);
  const files: DubFileRow[] = [];
  // 分离出的背景声与人声：时间线上那几段用的素材（各一份）；实例删了、素材还在库里的也列一行。
  const stemText = (stem: unknown) => (stem === 'vocals' ? M.stemVocals : M.stemBackground);
  const bedAssets = new Set<Id>();
  for (const { item, mark, range } of beds) {
    const assetId = assetOf(item);
    if (assetId && bedAssets.has(assetId)) continue;
    if (assetId) bedAssets.add(assetId);
    const asset = assetId ? assets[assetId] : undefined;
    files.push({
      key: item.id,
      kind: 'bed',
      itemId: item.id,
      name: asset?.name ?? item.name ?? M.background,
      text: stemText(mark.stem),
      status: null,
      muted: silent(item),
      seconds: secondsOf(asset) ?? (range.end - range.start) / perSecond,
    });
  }
  for (const asset of owned) {
    if (!dubGroupOfAsset(asset)!.stem || bedAssets.has(asset.id)) continue;
    const text = stemText(dubGroupOfAsset(asset)!.stem);
    files.push({ key: asset.id, kind: 'bed', itemId: null, name: asset.name, text, status: null, muted: false, seconds: secondsOf(asset) });
  }

  const units = planUnits(planBody);
  const unitOf = new Map((units ?? []).map((u) => [u.unitId, u]));
  const placed = new Set<string>();
  for (const { item, mark, range } of sentences) {
    const unitId = typeof mark.unitId === 'string' ? mark.unitId : null;
    const unit = unitId ? unitOf.get(unitId) : undefined;
    if (unitId) placed.add(unitId);
    const assetId = assetOf(item);
    files.push({
      key: item.id,
      kind: 'sentence',
      itemId: item.id,
      name: unit ? M.sentenceN(unit.index + 1) : (item.name ?? (assetId ? assets[assetId]?.name : undefined) ?? M.dub),
      text: unit?.text ?? '',
      status: null,
      muted: silent(item),
      seconds: (range.end - range.start) / perSecond,
    });
  }
  for (const unit of units ?? []) {
    if (placed.has(unit.unitId) || unit.status === 'ready') continue;
    const status = unit.status === 'failed' || unit.status === 'needs-fit' || unit.status === 'stale' ? unit.status : 'draft';
    files.push({
      key: `unit:${unit.unitId}`,
      kind: 'sentence',
      itemId: null,
      name: M.sentenceN(unit.index + 1),
      text: unit.text,
      status,
      muted: false,
      seconds: null,
    });
  }

  const count = (status: DubFileRow['status']) => files.filter((f) => f.status === status).length;
  const fileCount = new Set([...items.map((e) => assetOf(e.item)).filter((id): id is Id => !!id), ...owned.map((a) => a.id)]).size;
  const parts = [M.files(fileCount), M.sentences(units ? units.length : sentences.length)];
  for (const status of ['failed', 'needs-fit', 'stale', 'draft'] as const) {
    const n = count(status);
    if (n) parts.push(M.dubStatusCount(n, status));
  }
  const muted = files.filter((f) => f.kind === 'sentence' && f.muted).length;
  if (muted) parts.push(M.muted(muted));
  const engine = planEngine(planBody);
  if (engine) parts.push(engine);

  const trackId = sentences[0]?.item.trackId ?? null;
  const track = trackId ? sequence?.tracks.find((t) => t.id === trackId) : undefined;
  const state: DubGroupCard['state'] = !items.length ? 'gone' : !track || track.muted || sentences.every((e) => !e.item.enabled) ? 'off' : 'on';
  return {
    groupId,
    language,
    badge: language ? language.split('-')[0]!.toUpperCase() : M.dub,
    title: M.dubTitle(language ? languageName(language) : null),
    line: parts.join(' · '),
    state,
    files,
    trackId,
    itemIds: items.map((e) => e.item.id),
    regen: count('failed') + count('needs-fit'),
  };
}

/** 段头旁注（设计稿 `audioAside`）：`2 组配音 · 65 个文件` / `2 个文件`。 */
export function audioAside(groups: number, files: number): string {
  return M.aside(groups, files);
}

// ---- 画布上的「层级」 ----

/**
 * 这一件还能不能往这个方向换一层。叠放次序就是轨道的上下（命令协议规范 §4.2 `arrangeItem`）：与别的片段共用一条轨道的
 * 总能拆到相邻新建的轨道上；独占一条轨道、又已经在同类轨道的最上 / 最下时不能再走。声音与字幕没有叠放次序。
 */
export function canArrange(sequence: Sequence, itemId: Id, direction: ArrangeDirection): boolean {
  const item = sequence.items.find((candidate) => candidate.id === itemId);
  if (!item || item.type === 'audio' || item.type === 'caption') return false;
  const track = sequence.tracks.find((candidate) => candidate.id === item.trackId);
  if (!track) return false;
  if (sequence.items.some((other) => other.trackId === item.trackId && other.id !== itemId)) return true;
  const upward = direction === 'forward' || direction === 'front';
  return sequence.tracks.some((other) => other.kind === track.kind && (upward ? other.order > track.order : other.order < track.order));
}

/** 「层级」的一笔；走不动时 null（菜单项灰着，快捷键什么都不做）。 */
export function arrangeOperation(sequence: Sequence, itemId: Id, direction: ArrangeDirection): EditOperation | null {
  if (!canArrange(sequence, itemId, direction)) return null;
  return { type: 'arrangeItem', sequenceId: sequence.id, itemId, direction };
}
