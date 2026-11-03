import type { AssetRecord, AudioItem, EditOperation, Id, MediaTime, Sequence, SequenceItemInput, VersionRef } from '@baocut/protocol';
import { mediaTimeToSeconds } from '@baocut/protocol';
import { durationSeconds } from './editor.ts';
import { M } from './tools-music-copy.ts';

/**
 * 配乐铺满（产品设计 §2.7「生成配乐」、架构设计 §7.9「生成配乐的铺轨」；设计稿 model-music.js `loopLayout`）：
 * 视频比单次上限长时只生成上限长度的一段，加到视频时首尾相接循环铺满——后一段在前一段结束前 `crossfade` 秒进来、两边交叉淡化，
 * 最后一段截到视频结尾、片尾淡出；不拉伸、不改节奏。同一条轨道上的实例不能重叠（视频格式规范 §3.4），接缝两侧交替放在两条音乐轨上；
 * 淡入淡出都在实例 [0, 5] 秒之内、两者之和不超过片段长度（§3.9）。
 * 写入是一笔事务：`addTrack`（一或两条音乐轨）加一个 `insertItems`，每段一个音频实例带 `playDuration`（这就是截断）与 `mix` 的淡化；
 * 一次撤销整笔回去。
 */

export const LOOP = { crossfade: 2, tailFade: 3 } as const;

/** 加到视频的音乐实例的作用（开放词表，§3.1）。 */
export const MUSIC_ROLE = 'music';
/** 铺上去的每段实例带的扩展（引擎不解释）：是哪个「生成配乐」任务铺的。一部视频只留一床配乐：再铺时先删掉上一床。 */
export const SOUNDTRACK_EXTENSION = 'baocut.soundtrack';

export interface LoopPiece {
  /** 在序列上的起点、长度（秒，精确到毫秒）。 */
  start: number;
  dur: number;
  /** 交替的两条音乐轨：0 / 1。 */
  lane: 0 | 1;
  fadeIn: number;
  fadeOut: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** 向下取整到毫秒：铺上去的长度不能比素材长、不能越过序列末尾。 */
const floorMs = (n: number) => Math.floor(n * 1000 + 1e-6) / 1000;

/**
 * 一段 `pieceSec` 秒的音乐铺满 `totalSec` 秒：每段从音乐开头起放，后一段在前一段结束前 `crossfade` 秒进来；
 * 最后一段截到视频结尾、带片尾淡出；音乐比视频长时只有一段。时长不成立时空表。
 */
export function loopLayout(pieceSec: number, totalSec: number, opts: Partial<typeof LOOP> = {}): LoopPiece[] {
  const o = { ...LOOP, ...opts };
  const piece = Number(pieceSec);
  const total = Number(totalSec);
  if (!(piece > 0) || !(total > 0)) return [];
  const xf = Math.min(o.crossfade, piece / 4);
  const out: LoopPiece[] = [];
  let start = 0;
  for (;;) {
    const dur = Math.min(piece, total - start);
    out.push({ start: r3(start), dur: r3(dur), lane: out.length % 2 === 0 ? 0 : 1, fadeIn: out.length ? r3(xf) : 0, fadeOut: 0 });
    if (start + piece >= total) break;
    start += piece - xf;
  }
  out.forEach((s, i) => {
    if (i < out.length - 1) s.fadeOut = r3(xf);
  });
  const last = out[out.length - 1]!;
  last.fadeOut = r3(Math.min(o.tailFade, Math.max(0, last.dur - last.fadeIn)));
  return out;
}

/** 加到视频之后的一句：「循环 3 段铺满 742 秒 · 接缝交叉淡化 2 秒 · 片尾淡出 3 秒」；只有一段时只说片尾淡出。 */
export function loopSummary(layout: readonly LoopPiece[], totalSec: number): string {
  if (!layout.length) return '';
  const tail = M.tailFade(layout[layout.length - 1]!.fadeOut);
  if (layout.length === 1) return tail;
  return [M.loopPieces(layout.length, r3(totalSec)), M.seamCrossfade(layout[1]!.fadeIn), tail].join(' · ');
}

/** 素材当前版本的实际时长（秒）；音乐的长度以做出来的为准，不是请求的目标。 */
export function pieceSeconds(asset: AssetRecord): number | null {
  const duration = asset.revisions[asset.currentRevision]?.duration;
  return duration ? mediaTimeToSeconds(duration) : null;
}

/** 整数毫秒写成精确时间。 */
const ms = (seconds: number): MediaTime => ({ ticks: String(Math.round(seconds * 1000)), timescale: 1000 });

/** 新建音乐轨在同一事务里的 `ref`。 */
const trackRef = (lane: 0 | 1) => `music-bed-${lane}`;

/** 已经铺在时间线上的配乐实例（带 `SOUNDTRACK_EXTENSION`）。 */
export function soundtrackBedItems(sequence: Sequence): AudioItem[] {
  return sequence.items.filter((item): item is AudioItem => item.type === 'audio' && !!item.extensions?.[SOUNDTRACK_EXTENSION]);
}

/** 时间线上这些配乐实例来自哪些任务。 */
export function placedSoundtrackJobs(sequence: Sequence): Set<Id> {
  const out = new Set<Id>();
  for (const item of soundtrackBedItems(sequence)) {
    const mark = item.extensions?.[SOUNDTRACK_EXTENSION];
    const jobId = typeof mark === 'object' && mark !== null ? (mark as { jobId?: unknown }).jobId : undefined;
    if (typeof jobId === 'string') out.add(jobId);
  }
  return out;
}

/** 换掉上一床配乐：删掉它的实例，只放着它们的音乐轨一并删掉（轨上还有别的东西就留着）。 */
function replaceOperations(sequence: Sequence): EditOperation[] {
  const olds = soundtrackBedItems(sequence);
  if (!olds.length) return [];
  const ids = new Set(olds.map((o) => o.id));
  const emptied = sequence.tracks.filter((t) => t.kind === 'audio' && !t.locked && sequence.items.some((i) => i.trackId === t.id) && sequence.items.every((i) => i.trackId !== t.id || ids.has(i.id)));
  return [
    { type: 'deleteItems', sequenceId: sequence.id, itemIds: olds.map((o) => o.id) },
    ...emptied.map((t): EditOperation => ({ type: 'deleteTrack', sequenceId: sequence.id, trackId: t.id })),
  ];
}

export interface MusicBed {
  operations: EditOperation[];
  layout: LoopPiece[];
  totalSec: number;
}

/**
 * 把这段音乐循环铺满这部视频的那一笔操作：按实际时长算铺法，新建用到的音乐轨（一或两条），每段一个音频实例
 * （从音乐开头起、`playDuration` 截到该段长度、淡入淡出按铺法，带 `jobId` 的扩展）；上一床配乐在同一笔里换掉。
 * 时长向下取整到毫秒：铺的长度不超过素材、不越过序列末尾。视频没有时长、素材不是音频或没有时长时 null。
 */
export function musicBedOperations(sequence: Sequence, asset: AssetRecord, jobId: Id): MusicBed | null {
  if (asset.kind !== 'audio') return null;
  const piece = pieceSeconds(asset);
  if (piece === null) return null;
  return bedOperations(sequence, { assetRef: { id: asset.id, revision: asset.currentRevision } }, asset.name, piece, floorMs(durationSeconds(sequence)), jobId);
}

/**
 * 工具结果行的「加到视频」（产品设计 §2.7）：铺法与上一床的去留同上，只是音乐在同一笔事务里刚导入（`importAsset` 的 `ref`），
 * 时长取结果记下的实际时长，导入与铺轨一步撤销。时间线还空着时没有长度要铺满，放一段完整的音乐。时长不成立时 null。
 */
export function importedMusicBedOperations(sequence: Sequence, source: { ref: string; name: string; pieceSec: number }, jobId: Id): MusicBed | null {
  const video = floorMs(durationSeconds(sequence));
  return bedOperations(sequence, { assetImportRef: source.ref }, source.name, source.pieceSec, video > 0 ? video : floorMs(source.pieceSec), jobId);
}

function bedOperations(
  sequence: Sequence,
  target: { assetRef: VersionRef } | { assetImportRef: string },
  name: string,
  pieceSec: number,
  total: number,
  jobId: Id,
): MusicBed | null {
  if (!(pieceSec > 0) || !(total > 0)) return null;
  const layout = loopLayout(floorMs(pieceSec), total);
  if (!layout.length) return null;
  const { num, den } = sequence.fps;
  const lanes = [...new Set(layout.map((p) => p.lane))].sort();
  const items: SequenceItemInput[] = layout.map((p) => {
    // 起点拆成帧与帧内偏移（视频格式规范 §2.10）：都按毫秒的整数算，不经浮点。
    const startMs = Math.round(p.start * 1000);
    const fromFrame = Math.floor((startMs * num) / (1000 * den));
    const subframeTicks = startMs * num - fromFrame * den * 1000;
    return {
      type: 'audio',
      trackRef: trackRef(p.lane),
      ...target,
      fromFrame,
      subframeOffset: { ticks: String(subframeTicks), timescale: 1000 * num },
      playDuration: ms(p.dur),
      timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 1 }, rate: { num: 1, den: 1 } },
      mix: { volume: 1, ...(p.fadeIn > 0 ? { fadeIn: ms(p.fadeIn) } : {}), ...(p.fadeOut > 0 ? { fadeOut: ms(p.fadeOut) } : {}) },
      name,
      role: MUSIC_ROLE,
      extensions: { [SOUNDTRACK_EXTENSION]: { jobId } },
    };
  });
  const operations: EditOperation[] = [
    ...replaceOperations(sequence),
    ...lanes.map((lane): EditOperation => ({ type: 'addTrack', sequenceId: sequence.id, kind: 'audio', ref: trackRef(lane), name: M.musicTrack(lane + 1) })),
    { type: 'insertItems', sequenceId: sequence.id, items },
  ];
  return { operations, layout, totalSec: total };
}

/** 这段素材已经在时间线上了（用户自己放过）：不再自动铺。 */
export function assetOnTimeline(sequence: Sequence, assetId: Id): boolean {
  return sequence.items.some((item) => item.type === 'audio' && item.assetRef.id === assetId);
}

/** 这个任务的音乐已经在时间线上了：铺过（实例的扩展记着任务），或用户把它的素材（来源记着任务）放上去了。不再铺。 */
export function jobOnTimeline(sequence: Sequence, assets: Record<Id, AssetRecord>, jobId: Id): boolean {
  if (placedSoundtrackJobs(sequence).has(jobId)) return true;
  return Object.values(assets).some((asset) => {
    const source = asset.revisions[asset.currentRevision]?.provenance.source;
    const owner = typeof source === 'object' && source !== null ? (source as { jobId?: unknown }).jobId : undefined;
    return owner === jobId && assetOnTimeline(sequence, asset.id);
  });
}
