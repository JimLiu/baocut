import { defineMessages } from '@baocut/protocol';
import type { AssetRecord, AudioItem, EditOperation, Id, MediaTime, Rate, Sequence, SequenceItem, TimeMap, VersionRef, VideoItem } from '@baocut/protocol';
import { itemFrames } from './editor.ts';
import type { PlaceableKind } from './editor-ops.ts';
import { zhHans } from './asset-replace.zh-Hans.ts';
import { zhHant } from './asset-replace.zh-Hant.ts';
import { ja } from './asset-replace.ja.ts';
import { ko } from './asset-replace.ko.ts';
import { es } from './asset-replace.es.ts';
import { fr } from './asset-replace.fr.ts';
import { de } from './asset-replace.de.ts';
import { nl } from './asset-replace.nl.ts';
import { ptBR } from './asset-replace.pt-BR.ts';
import { it } from './asset-replace.it.ts';
import { ru } from './asset-replace.ru.ts';
import { pl } from './asset-replace.pl.ts';
import { tr } from './asset-replace.tr.ts';
import { vi } from './asset-replace.vi.ts';

/**
 * 替换素材（设计稿 model-video-replace.js 的规则，搬到素材库这一层）：时间线上用到旧素材的每个实例换成新素材，一笔事务——
 * 本地文件先 `importAsset`（带 `ref`）；变短的片段 `trimItem` 收短终点，`moveItems` 挪同轨后面的片段（换掉的片段自己也在里面），
 * 再逐个 `replaceItemAsset` 原地换素材与时间映射（命令与协议规范 §4.2）；淡入淡出放不下时 `setAudioMix` 收进新长度，片段名还是
 * 旧素材名时 `updateItem` 跟着改。撤销一步回去。
 *
 * 实例 ID 不变，布局、裁剪、效果、关键帧、音量、作用与扩展都留在原处；挂在它上面的转场、按它投影的字幕（`scopeItemIds`）与
 * 指着它的闪避照样对得上。新素材余量不够的两侧转场由引擎在事务末尾去掉，列在回执里。
 *
 * 时间的规则：
 * - 新素材从 0 秒起（设计稿二次修订去掉了开始时间）；勾了「按原素材时间对齐」且原来取用的那一段在新素材里放得下时，源时间照旧
 *   （设计稿的 `aligned`：同一段内容的另一个版本）。
 * - 片段长度不变；新素材不够长时片段跟着变短（设计稿「片段长度跟着新素材走」只取变短这一半：素材库这一层一次换掉所有用到它的
 *   片段，变长会把拆开的几段都拉成整段新素材），同一条轨道上后面的片段往前挪（ripple），别的轨道不动。音频变短时终点落在帧上。
 * - 新素材的时长不知道（本地文件要导入之后才探测）：先保留片段原时长（设计稿 `keep`），新文件不够长时引擎整笔拒绝。
 * - 锁着的片段（或在锁着的轨道上）与合成的预渲染替身保持原样；同轨的波纹挪到锁着的片段为止。
 *
 * 画布工具条上的「替换视频 / 替换图片」只换选中的那一段（`itemId`）：同样的规则，只是用到这个素材的别的片段不动。
 */

/** 用来替换的新素材：素材库里已有的同类素材，或要在同一笔事务里导入的本地文件。 */
export type ReplaceSource = { from: 'library'; asset: AssetRecord } | { from: 'file'; path: string; name: string; kind: PlaceableKind | null };

export interface AssetReplaceInput {
  sequence: Sequence;
  /** 要换掉的素材。 */
  asset: AssetRecord;
  source: ReplaceSource;
  /** 按原素材时间对齐：原来取用的那一段在新素材里放得下时，源时间照旧。 */
  align?: boolean;
  /** 只换这一段（画布工具条）；缺省换掉时间线上用到这个素材的每一段。 */
  itemId?: Id;
}

export interface ReplacedInstance {
  itemId: Id;
  trackId: Id;
  name: string;
  /** 原来的起止（秒）。 */
  start: number;
  end: number;
  /** 换完之后的起点与终点（秒）：同轨前面的片段变短时起点跟着往前。 */
  newStart: number;
  newEnd: number;
  /** 片段长度变了多少秒（≤ 0）。 */
  delta: number;
  /** 源时间照旧（按原素材时间对齐）。 */
  aligned: boolean;
}

export interface KeptInstance {
  itemId: Id;
  name: string;
  start: number;
  end: number;
  reason: 'locked' | 'prerender';
}

export type AssetReplacePlan =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** 新素材的时长知道（素材库里的）；本地文件为 false。 */
      durationKnown: boolean;
      replaced: ReplacedInstance[];
      kept: KeptInstance[];
      /** 同轨跟着往前挪的片段数。 */
      moved: number;
      /** 所有片段加起来短了多少秒（≤ 0）。 */
      delta: number;
      operations: EditOperation[];
    };

/** 同一笔事务里导入新文件用的 `ref`。 */
export const REPLACE_IMPORT_REF = 'replacement';

// ---- 精确时间：分数（BigInt），与引擎一样按值算，不经浮点 ----

interface Q {
  n: bigint;
  d: bigint;
}
const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x || 1n;
};
const q = (n: bigint, d: bigint): Q => {
  const sign = d < 0n ? -1n : 1n;
  const g = gcd(n, d);
  return { n: (sign * n) / g, d: (sign * d) / g };
};
const ofTime = (t: MediaTime): Q => q(BigInt(t.ticks), BigInt(t.timescale));
const ofRate = (r: Rate): Q => q(BigInt(r.num), BigInt(r.den));
const add = (a: Q, b: Q): Q => q(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Q, b: Q): Q => q(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q): Q => q(a.n * b.n, a.d * b.d);
const div = (a: Q, b: Q): Q => q(a.n * b.d, a.d * b.n);
const cmp = (a: Q, b: Q): number => {
  const x = a.n * b.d - b.n * a.d;
  return x < 0n ? -1 : x > 0n ? 1 : 0;
};
const minQ = (a: Q, b: Q): Q => (cmp(a, b) <= 0 ? a : b);
const floorQ = (a: Q): bigint => (a.n >= 0n ? a.n / a.d : -((-a.n + a.d - 1n) / a.d));
const toNumber = (a: Q): number => Number(a.n) / Number(a.d);
const ZERO: Q = { n: 0n, d: 1n };
const MICRO = 1_000_000n;
/** 向下取到微秒：`setAudioMix` 的淡变只收十进制秒。 */
const floorMicro = (a: Q): Q => q(floorQ(mul(a, q(MICRO, 1n))), MICRO);
const decimal = (a: Q): string => {
  const micros = floorQ(mul(a, q(MICRO, 1n)));
  const frac = micros % MICRO;
  return frac ? `${micros / MICRO}.${String(frac).padStart(6, '0').replace(/0+$/, '')}` : String(micros / MICRO);
};

/** 帧数 → 秒（分数）。 */
const framesQ = (frames: number, fps: Rate): Q => q(BigInt(frames) * BigInt(fps.den), BigInt(fps.num));

// ---- 一个实例换成新素材之后的时间 ----

interface Timing {
  /** 换上的时间映射；省略是不改（图片没有时间映射）。 */
  timeMap?: TimeMap;
  /** 变短时终点收到哪一帧（`trimItem`），没变短时省略。 */
  endFrame?: number;
  /** 变短之后的长度（秒），淡入淡出放不下时按它收。 */
  length?: Q;
  /** 同轨后面的片段往前挪几帧（≥ 0）。 */
  shrinkFrames: number;
  /** 片段短了几秒（≥ 0），给替换框看。 */
  shrinkSeconds: number;
  aligned: boolean;
}

const restartMap = (map: TimeMap): TimeMap =>
  map.kind === 'linear'
    ? { kind: 'linear', sourceIn: { ticks: '0', timescale: map.sourceIn.timescale }, rate: map.rate }
    : { kind: 'hold', sourceAt: { ticks: '0', timescale: map.sourceAt.timescale } };

/** 时间映射在新素材里还成立吗（原来取用的那一段放得下）。 */
function fits(map: TimeMap, length: Q, duration: Q): boolean {
  if (map.kind === 'hold') return cmp(ofTime(map.sourceAt), duration) < 0;
  return cmp(add(ofTime(map.sourceIn), mul(length, ofRate(map.rate))), duration) <= 0;
}

/** 从 0 秒起，新素材能放多长（秒）。 */
const reach = (map: TimeMap, duration: Q): Q | null => (map.kind === 'linear' ? div(duration, ofRate(map.rate)) : null);

const unchanged = (aligned: boolean, timeMap?: TimeMap): Timing => ({ ...(timeMap ? { timeMap } : {}), shrinkFrames: 0, shrinkSeconds: 0, aligned });

function videoTiming(item: VideoItem, fps: Rate, duration: Q | null, align: boolean): Timing | null {
  const lengthFrames = item.span.durationFrames;
  const length = framesQ(lengthFrames, fps);
  if (align && duration && fits(item.timeMap, length, duration)) return unchanged(true);
  // 时长未知：先保留原时长（设计稿 `keep`）；对齐时源时间也照旧。
  if (!duration) return align ? unchanged(true) : unchanged(false, restartMap(item.timeMap));
  const most = reach(item.timeMap, duration);
  const maxFrames = most ? Number(floorQ(mul(most, ofRate(fps)))) : lengthFrames;
  if (maxFrames < 1) return null;
  if (maxFrames >= lengthFrames) return unchanged(false, restartMap(item.timeMap));
  const shrinkFrames = lengthFrames - maxFrames;
  return {
    timeMap: restartMap(item.timeMap),
    endFrame: item.span.fromFrame + maxFrames,
    length: framesQ(maxFrames, fps),
    shrinkFrames,
    shrinkSeconds: toNumber(framesQ(shrinkFrames, fps)),
    aligned: false,
  };
}

function audioTiming(item: AudioItem, fps: Rate, duration: Q | null, align: boolean): Timing | null {
  const length = ofTime(item.playDuration);
  if (align && duration && fits(item.timeMap, length, duration)) return unchanged(true);
  if (!duration) return align ? unchanged(true) : unchanged(false, restartMap(item.timeMap));
  const most = reach(item.timeMap, duration);
  if (!most || cmp(length, most) <= 0) return unchanged(false, restartMap(item.timeMap));
  // 变短：终点收到新素材放得下的最后一帧（`trimItem` 的时间按帧给）；同轨后面的片段按帧往前挪，不重叠（起点不在帧上时留下不到一帧的缝）。
  const start = add(framesQ(item.fromFrame, fps), ofTime(item.subframeOffset));
  const endFrame = Number(floorQ(mul(add(start, most), ofRate(fps))));
  const next = sub(framesQ(endFrame, fps), start);
  if (cmp(next, ZERO) <= 0) return null;
  const shrink = sub(length, next);
  return {
    timeMap: restartMap(item.timeMap),
    endFrame,
    length: next,
    shrinkFrames: Number(floorQ(mul(shrink, ofRate(fps)))),
    shrinkSeconds: toNumber(shrink),
    aligned: false,
  };
}

/** 片段变短之后淡入淡出放不下时收进新长度（淡出优先）；放得下时不用改，返回 null。引擎要求淡入加淡出不超过片段长度。 */
function clampFades(fades: { fadeIn?: MediaTime; fadeOut?: MediaTime }, length: Q): { fadeIn?: string; fadeOut?: string } | null {
  const fadeIn = fades.fadeIn ? ofTime(fades.fadeIn) : ZERO;
  const fadeOut = fades.fadeOut ? ofTime(fades.fadeOut) : ZERO;
  if (cmp(add(fadeIn, fadeOut), length) <= 0) return null;
  const out = cmp(fadeOut, length) > 0 ? floorMicro(length) : fadeOut;
  const room = sub(length, out);
  const inn = cmp(fadeIn, room) > 0 ? floorMicro(room) : fadeIn;
  return {
    ...(cmp(inn, fadeIn) !== 0 ? { fadeIn: decimal(inn) } : {}),
    ...(cmp(out, fadeOut) !== 0 ? { fadeOut: decimal(out) } : {}),
  };
}

// ---- 计划 ----

/** 替换素材的文案（英文是键与类型的来源，译文在 `asset-replace.zh-Hans.ts`）。 */
const en = {
  cantReplaceKind: 'This kind of asset can’t be replaced yet.',
  sameKind: (kind: PlaceableKind) => `You can only replace it with an asset of the same kind: this needs ${{ video: 'a video', image: 'an image', audio: 'an audio' }[kind]} asset.`,
  sameAsset: 'That’s the current asset. Pick a different one.',
  unused: 'This asset isn’t used on the timeline, so there’s nothing to replace.',
  tooShort: 'The new asset is too short to fill a single frame.',
  allLocked: 'Every clip that uses it is locked (or is a prerendered stand-in for a composition). Unlock them first.',
  clipLocked: 'This clip is locked. Unlock it first.',
  durationUnknown: 'The asset’s length is unknown, so the clips keep their current length for now.',
  longEnoughMany: 'The new asset is long enough. None of these clips change length, and the timeline stays the same.',
  longEnoughOne: 'The new asset is long enough. The clip keeps its length, and the timeline stays the same.',
  shortenMany: (n: number, seconds: string) => `${n === 1 ? '1 clip gets' : `${n} clips get`} shorter, ${seconds} sec in total`,
  shortenOne: (seconds: string) => `The clip gets ${seconds} sec shorter`,
  moved: (head: string, n: number) => `${head}, and ${n === 1 ? 'the next clip' : `the next ${n} clips`} on the track move earlier.`,
  trackShorter: (head: string) => `${head}, and the track gets shorter.`,
};
export type AssetReplaceMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

function sourceKind(source: ReplaceSource): PlaceableKind | null {
  if (source.from === 'file') return source.kind;
  const kind = source.asset.kind;
  return kind === 'video' || kind === 'image' || kind === 'audio' ? kind : null;
}

function sourceDuration(source: ReplaceSource): Q | null {
  if (source.from === 'file') return null;
  const duration = source.asset.revisions[source.asset.currentRevision]?.duration;
  return duration && BigInt(duration.ticks) > 0n ? ofTime(duration) : null;
}

const usesAsset = (item: SequenceItem, assetId: Id) =>
  ((item.type === 'video' || item.type === 'image' || item.type === 'audio') && item.assetRef.id === assetId) ||
  (item.type === 'composition' && item.prerender?.id === assetId);

/** 算一次替换：换哪些片段、各变多长、同轨挪哪些，以及那一笔操作。不改时间线，只算。 */
export function planAssetReplace({ sequence, asset, source, align = false, itemId }: AssetReplaceInput): AssetReplacePlan {
  const fail = (reason: string) => ({ ok: false as const, reason });
  const kind = asset.kind;
  if (kind !== 'video' && kind !== 'image' && kind !== 'audio') return fail(M.cantReplaceKind);
  const incoming = sourceKind(source);
  if (incoming !== kind) return fail(M.sameKind(kind));
  if (source.from === 'library' && source.asset.id === asset.id) return fail(M.sameAsset);
  const fps = sequence.fps;
  const toSeconds = (frames: number) => (frames * fps.den) / fps.num;
  const lockedTracks = new Set(sequence.tracks.filter((t) => t.locked).map((t) => t.id));
  const users = sequence.items.filter((item) => usesAsset(item, asset.id) && (itemId === undefined || item.id === itemId));
  if (!users.length) return fail(M.unused);

  const duration = sourceDuration(source);
  const target: { assetRef: VersionRef } | { assetImportRef: string } =
    source.from === 'library' ? { assetRef: { id: source.asset.id, revision: source.asset.currentRevision } } : { assetImportRef: REPLACE_IMPORT_REF };
  const newName = source.from === 'library' ? source.asset.name : source.name;

  const kept: KeptInstance[] = [];
  const timings = new Map<Id, Timing>();
  for (const item of users) {
    const range = itemFrames(item, fps);
    const facts = { itemId: item.id, name: item.name ?? asset.name, start: toSeconds(range.start), end: toSeconds(range.end) };
    if (item.type === 'composition') kept.push({ ...facts, reason: 'prerender' });
    else if (item.locked || lockedTracks.has(item.trackId)) kept.push({ ...facts, reason: 'locked' });
    else {
      const timing =
        item.type === 'video' ? videoTiming(item, fps, duration, align) : item.type === 'audio' ? audioTiming(item, fps, duration, align) : unchanged(false);
      if (!timing) return fail(M.tooShort);
      timings.set(item.id, timing);
    }
  }
  if (!timings.size) return fail(itemId === undefined ? M.allLocked : M.clipLocked);

  // 同轨的波纹：按起点排，变短的片段之后的往前挪累计的帧数（换掉的片段自己也挪）；碰到锁着的片段就停（它和它后面的不动）。
  const shiftOf = new Map<Id, number>();
  const moves: { itemId: Id; frames: number }[] = [];
  for (const trackId of new Set(users.filter((i) => timings.has(i.id)).map((i) => i.trackId))) {
    const lane = sequence.items
      .filter((item) => item.trackId === trackId)
      .map((item) => ({ item, start: itemFrames(item, fps).start }))
      .sort((a, b) => a.start - b.start || a.item.id.localeCompare(b.item.id));
    let shift = 0;
    for (const { item } of lane) {
      if (item.locked) {
        shift = 0;
        continue;
      }
      if (shift !== 0) moves.push({ itemId: item.id, frames: shift });
      const timing = timings.get(item.id);
      if (timing) {
        shiftOf.set(item.id, shift);
        shift -= timing.shrinkFrames;
      }
    }
  }

  const replaced: ReplacedInstance[] = [];
  const trims: EditOperation[] = [];
  const swaps: EditOperation[] = [];
  const mixes: EditOperation[] = [];
  const renames: EditOperation[] = [];
  const sequenceId = sequence.id;
  for (const item of users) {
    const timing = timings.get(item.id);
    if (!timing || (item.type !== 'video' && item.type !== 'audio' && item.type !== 'image')) continue;
    const shift = shiftOf.get(item.id) ?? 0;
    const range = itemFrames(item, fps);
    if (timing.endFrame !== undefined)
      trims.push({ type: 'trimItem', sequenceId, itemId: item.id, edge: 'end', at: { unit: 'frames', value: timing.endFrame }, alignment: 'exact-frame' });
    swaps.push({ type: 'replaceItemAsset', sequenceId, itemId: item.id, ...target, ...(timing.timeMap ? { timeMap: timing.timeMap } : {}) });
    const fades = timing.length && item.type !== 'image' ? clampFades(item.type === 'video' ? item.embeddedAudio : item.mix, timing.length) : null;
    if (fades && (fades.fadeIn !== undefined || fades.fadeOut !== undefined)) mixes.push({ type: 'setAudioMix', sequenceId, itemId: item.id, ...fades });
    // 片段名还是旧素材的名字（放上时间线时的默认名）就跟着换成新素材的名字；改过名的保留。
    if (item.name === asset.name && newName !== asset.name) renames.push({ type: 'updateItem', sequenceId, itemId: item.id, name: newName });
    replaced.push({
      itemId: item.id,
      trackId: item.trackId,
      name: item.name ?? asset.name,
      start: toSeconds(range.start),
      end: toSeconds(range.end),
      newStart: toSeconds(range.start + shift),
      newEnd: toSeconds(range.end + shift) - timing.shrinkSeconds,
      delta: 0 - timing.shrinkSeconds,
      aligned: timing.aligned,
    });
  }

  // 顺序：导入 → 收短 → 挪（重叠在整笔之后检查）→ 换素材 → 收淡变 → 改名。
  const operations: EditOperation[] = [];
  if (source.from === 'file') operations.push({ type: 'importAsset', path: source.path, ref: REPLACE_IMPORT_REF });
  operations.push(...trims);
  if (moves.length)
    operations.push({
      type: 'moveItems',
      sequenceId,
      moves: moves.map((m) => ({ itemId: m.itemId, offset: { unit: 'frames', value: m.frames } })),
      alignment: 'exact-frame',
    });
  operations.push(...swaps, ...mixes, ...renames);

  return {
    ok: true,
    durationKnown: duration !== null,
    replaced,
    kept,
    moved: moves.filter((m) => !timings.has(m.itemId)).length,
    delta: replaced.reduce((sum, r) => sum + r.delta, 0),
    operations,
  };
}

/** 一句话说清这次替换对时间线的影响（设计稿 `describe` 的说法，搬到一次换多段）。 */
export function describeReplace(plan: AssetReplacePlan): string {
  if (!plan.ok) return plan.reason;
  if (!plan.durationKnown) return M.durationUnknown;
  const shortened = plan.replaced.filter((r) => r.delta < 0);
  if (!shortened.length) return plan.replaced.length > 1 ? M.longEnoughMany : M.longEnoughOne;
  const d = Math.abs(plan.delta).toFixed(1);
  const head = plan.replaced.length > 1 ? M.shortenMany(shortened.length, d) : M.shortenOne(d);
  return plan.moved ? M.moved(head, plan.moved) : M.trackShorter(head);
}
