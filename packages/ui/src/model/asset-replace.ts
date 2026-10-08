import { defineMessages } from '@baocut/protocol';
import type {
  AssetRecord,
  AudioItem,
  EditOperation,
  EmbeddedAudio,
  EnvelopePoint,
  Id,
  MediaTime,
  Rate,
  Sequence,
  SequenceItem,
  SequenceItemInput,
  TimeMap,
  VersionRef,
  VideoItem,
} from '@baocut/protocol';
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
 * 本地文件先 `importAsset`（带 `ref`），再 `deleteItems` 删掉旧实例、`moveItems` 挪同轨后面的片段、`insertItems` 按原样写回
 * （同轨道、同起点，布局、裁剪、效果、音量、名字、作用与扩展照抄，只换素材与时间映射），撤销一步回去。
 *
 * 时间的规则：
 * - 新素材从 0 秒起（设计稿二次修订去掉了开始时间）；勾了「按原素材时间对齐」且原来取用的那一段在新素材里放得下时，源时间照旧
 *   （设计稿的 `aligned`：同一段内容的另一个版本）。
 * - 片段长度不变；新素材不够长时片段跟着变短（设计稿「片段长度跟着新素材走」只取变短这一半：素材库这一层一次换掉所有用到它的
 *   片段，变长会把拆开的几段都拉成整段新素材），同一条轨道上后面的片段往前挪同样多（ripple），别的轨道不动。
 * - 新素材的时长不知道（本地文件要导入之后才探测）：先保留片段原时长（设计稿 `keep`），新文件不够长时引擎整笔拒绝。
 * - 锁着的片段（或在锁着的轨道上）与合成的预渲染替身保持原样；同轨的波纹挪到锁着的片段为止。
 *
 * 协议里没有「给实例换素材」的操作，删了再写回的实例是新 ID：挂在它们上面的转场被引擎去掉，按它们投影的字幕、
 * 以它们为触发或目标的闪避对不上了。计划里数出这几样，替换框照实写出来。
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
      /** 删了再写回会丢掉的关联：挂在这些片段上的转场、按它们投影的字幕实例、用到它们的闪避规则。 */
      transitions: number;
      captions: number;
      ducking: number;
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
const ofInt = (v: number): Q => q(BigInt(v), 1n);
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
const ceilQ = (a: Q): bigint => -floorQ(q(-a.n, a.d));
const toTime = (a: Q): MediaTime => ({ ticks: String(a.n), timescale: Number(a.d) });
const ZERO: Q = { n: 0n, d: 1n };

/** 帧数 → 秒（分数）。 */
const framesQ = (frames: number, fps: Rate): Q => q(BigInt(frames) * BigInt(fps.den), BigInt(fps.num));

// ---- 一个实例换成新素材之后的时间 ----

interface Timing {
  /** 图片没有时间映射。 */
  timeMap?: TimeMap;
  /** 新长度：视频按帧，音频按精确时间。 */
  lengthFrames?: number;
  playDuration?: MediaTime;
  /** 片段变短了几帧（≥ 0）：同轨后面的片段往前挪这么多。 */
  shrinkFrames: number;
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

function videoTiming(item: VideoItem, fps: Rate, duration: Q | null, align: boolean): Timing | null {
  const lengthFrames = item.span.durationFrames;
  const length = framesQ(lengthFrames, fps);
  if (align && duration && fits(item.timeMap, length, duration)) return { timeMap: item.timeMap, lengthFrames, shrinkFrames: 0, aligned: true };
  // 时长未知：先保留原时长（设计稿 `keep`）；对齐时源时间也照旧。
  if (!duration) return { timeMap: align ? item.timeMap : restartMap(item.timeMap), lengthFrames, shrinkFrames: 0, aligned: align };
  const most = reach(item.timeMap, duration);
  const maxFrames = most ? Number(floorQ(mul(most, ofRate(fps)))) : lengthFrames;
  if (maxFrames < 1) return null;
  const next = Math.min(lengthFrames, maxFrames);
  return { timeMap: restartMap(item.timeMap), lengthFrames: next, shrinkFrames: lengthFrames - next, aligned: false };
}

function audioTiming(item: AudioItem, fps: Rate, duration: Q | null, align: boolean): Timing | null {
  const length = ofTime(item.playDuration);
  const keep = { playDuration: item.playDuration, shrinkFrames: 0 };
  if (align && duration && fits(item.timeMap, length, duration)) return { timeMap: item.timeMap, ...keep, aligned: true };
  if (!duration) return { timeMap: align ? item.timeMap : restartMap(item.timeMap), ...keep, aligned: align };
  const most = reach(item.timeMap, duration);
  if (!most || cmp(length, most) <= 0) return { timeMap: restartMap(item.timeMap), ...keep, aligned: false };
  // 变短整帧数：同轨后面的片段按帧往前挪，不留缝也不重叠（音频的起点可以不在帧上，长度按精确时间减）。
  const shrinkFrames = Number(ceilQ(mul(sub(length, most), ofRate(fps))));
  const next = sub(length, framesQ(shrinkFrames, fps));
  if (cmp(next, ZERO) <= 0) return null;
  return { timeMap: restartMap(item.timeMap), playDuration: toTime(next), shrinkFrames, aligned: false };
}

/** 片段变短之后淡入淡出放不下时收进新长度（淡出优先），包络去掉超出的点（引擎要求淡入加淡出不超过片段长度）。 */
function clampFades<T extends { fadeIn?: MediaTime; fadeOut?: MediaTime }>(fades: T, length: Q): T {
  const out = fades.fadeOut ? minQ(ofTime(fades.fadeOut), length) : null;
  const room = out ? sub(length, out) : length;
  const inn = fades.fadeIn ? minQ(ofTime(fades.fadeIn), room) : null;
  const next = { ...fades };
  if (fades.fadeOut) next.fadeOut = toTime(out!);
  if (fades.fadeIn) next.fadeIn = toTime(inn!);
  return next;
}
const clampEnvelope = (points: EnvelopePoint[] | undefined, length: Q) => points?.filter((p) => !p.at || cmp(ofTime(p.at), length) <= 0);

// ---- 计划 ----

/** 替换素材的文案（英文是键与类型的来源，译文在 `asset-replace.zh-Hans.ts`）。 */
const en = {
  cantReplaceKind: 'This kind of asset can’t be replaced yet.',
  sameKind: (kind: PlaceableKind) => `You can only replace it with an asset of the same kind: this needs ${{ video: 'a video', image: 'an image', audio: 'an audio' }[kind]} asset.`,
  sameAsset: 'That’s the current asset. Pick a different one.',
  unused: 'This asset isn’t used on the timeline, so there’s nothing to replace.',
  tooShort: 'The new asset is too short to fill a single frame.',
  allLocked: 'Every clip that uses it is locked (or is a prerendered stand-in for a composition). Unlock them first.',
  durationUnknown: 'The asset’s length is unknown, so the clips keep their current length for now.',
  longEnoughMany: 'The new asset is long enough. None of these clips change length, and the timeline stays the same.',
  longEnoughOne: 'The new asset is long enough. The clip keeps its length, and the timeline stays the same.',
  shortenMany: (n: number, seconds: string) => `${n === 1 ? '1 clip gets' : `${n} clips get`} shorter, ${seconds} sec in total`,
  shortenOne: (seconds: string) => `The clip gets ${seconds} sec shorter`,
  moved: (head: string, n: number) => `${head}, and ${n === 1 ? 'the next clip' : `the next ${n} clips`} on the track move earlier.`,
  trackShorter: (head: string) => `${head}, and the track gets shorter.`,
  transitions: (n: number) => (n === 1 ? 'The transition on these clips will be removed.' : `The ${n} transitions on these clips will be removed.`),
  captions: (n: number) =>
    `${n === 1 ? '1 caption is' : `${n} captions are`} timed against these clips and will need realigning after the replacement.`,
  ducking: (n: number) =>
    `${n === 1 ? '1 ducking rule points' : `${n} ducking rules point`} at these clips and won’t match after the replacement.`,
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
export function planAssetReplace({ sequence, asset, source, align = false }: AssetReplaceInput): AssetReplacePlan {
  const fail = (reason: string) => ({ ok: false as const, reason });
  const kind = asset.kind;
  if (kind !== 'video' && kind !== 'image' && kind !== 'audio') return fail(M.cantReplaceKind);
  const incoming = sourceKind(source);
  if (incoming !== kind) return fail(M.sameKind(kind));
  if (source.from === 'library' && source.asset.id === asset.id) return fail(M.sameAsset);
  const fps = sequence.fps;
  const toSeconds = (frames: number) => (frames * fps.den) / fps.num;
  const lockedTracks = new Set(sequence.tracks.filter((t) => t.locked).map((t) => t.id));
  const users = sequence.items.filter((item) => usesAsset(item, asset.id));
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
        item.type === 'video'
          ? videoTiming(item, fps, duration, align)
          : item.type === 'audio'
            ? audioTiming(item, fps, duration, align)
            : { shrinkFrames: 0, aligned: false };
      if (!timing) return fail(M.tooShort);
      timings.set(item.id, timing);
    }
  }
  if (!timings.size) return fail(M.allLocked);

  // 同轨的波纹：按起点排，变短的片段之后的往前挪累计的帧数；碰到锁着的片段就停（它和它后面的不动）。
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
      const timing = timings.get(item.id);
      if (timing) {
        shiftOf.set(item.id, shift);
        shift -= timing.shrinkFrames;
      } else if (shift !== 0) moves.push({ itemId: item.id, frames: shift });
    }
  }

  const replaced: ReplacedInstance[] = [];
  const inputs: SequenceItemInput[] = [];
  for (const item of users) {
    const timing = timings.get(item.id);
    if (!timing) continue;
    const shift = shiftOf.get(item.id) ?? 0;
    const range = itemFrames(item, fps);
    const input = rewrite(item, timing, shift, target, fps);
    if (!input) continue;
    // 片段名还是旧素材的名字（放上时间线时的默认名）就跟着换成新素材的名字；改过名的保留。
    inputs.push(item.name === asset.name ? ({ ...input, name: newName } as SequenceItemInput) : input);
    replaced.push({
      itemId: item.id,
      trackId: item.trackId,
      name: item.name ?? asset.name,
      start: toSeconds(range.start),
      end: toSeconds(range.end),
      newStart: toSeconds(range.start + shift),
      newEnd: toSeconds(range.end + shift - timing.shrinkFrames),
      delta: timing.shrinkFrames ? -toSeconds(timing.shrinkFrames) : 0,
      aligned: timing.aligned,
    });
  }

  const gone = new Set(replaced.map((r) => r.itemId));
  const operations: EditOperation[] = [];
  if (source.from === 'file') operations.push({ type: 'importAsset', path: source.path, ref: REPLACE_IMPORT_REF });
  operations.push({ type: 'deleteItems', sequenceId: sequence.id, itemIds: [...gone] });
  if (moves.length)
    operations.push({
      type: 'moveItems',
      sequenceId: sequence.id,
      moves: moves.map((m) => ({ itemId: m.itemId, offset: { unit: 'frames', value: m.frames } })),
      alignment: 'exact-frame',
    });
  operations.push({ type: 'insertItems', sequenceId: sequence.id, items: inputs });

  const touches = (ids: readonly Id[] | undefined) => !!ids?.some((id) => gone.has(id));
  return {
    ok: true,
    durationKnown: duration !== null,
    replaced,
    kept,
    moved: moves.length,
    delta: replaced.reduce((sum, r) => sum + r.delta, 0),
    transitions: sequence.transitions.filter((t) => (t.leftItemId && gone.has(t.leftItemId)) || (t.rightItemId && gone.has(t.rightItemId))).length,
    captions: sequence.items.filter((item) => item.type === 'caption' && touches(item.scopeItemIds)).length,
    ducking: (sequence.ducking ?? []).filter(
      (rule) => (rule.trigger.kind === 'items' && touches(rule.trigger.itemIds)) || touches(rule.target.itemIds),
    ).length,
    operations,
  };
}

/** 按原样写回一个实例：去掉引擎分配的 `id` 与 `lineage`，换素材与时间，起点挪 `shift` 帧。 */
function rewrite(
  item: SequenceItem,
  timing: Timing,
  shift: number,
  target: { assetRef: VersionRef } | { assetImportRef: string },
  fps: Rate,
): SequenceItemInput | null {
  if (item.type === 'video') {
    const { id: _id, lineage: _lineage, assetRef: _asset, ...rest } = item;
    const lengthFrames = timing.lengthFrames ?? item.span.durationFrames;
    const audio: EmbeddedAudio = timing.shrinkFrames ? clampFades(item.embeddedAudio, framesQ(lengthFrames, fps)) : item.embeddedAudio;
    return {
      ...rest,
      ...target,
      span: { fromFrame: item.span.fromFrame + shift, durationFrames: lengthFrames },
      timeMap: timing.timeMap ?? item.timeMap,
      embeddedAudio: audio,
    } as SequenceItemInput;
  }
  if (item.type === 'audio') {
    const { id: _id, lineage: _lineage, assetRef: _asset, ...rest } = item;
    const playDuration = timing.playDuration ?? item.playDuration;
    const length = ofTime(playDuration);
    let mix = item.mix;
    if (timing.shrinkFrames) {
      const { envelope: _envelope, ...fades } = clampFades(item.mix, length);
      const envelope = clampEnvelope(item.mix.envelope, length);
      mix = envelope?.length ? { ...fades, envelope } : fades;
    }
    return { ...rest, ...target, fromFrame: item.fromFrame + shift, playDuration, timeMap: timing.timeMap ?? item.timeMap, mix } as SequenceItemInput;
  }
  if (item.type === 'image') {
    const { id: _id, lineage: _lineage, assetRef: _asset, ...rest } = item;
    return { ...rest, ...target, span: { fromFrame: item.span.fromFrame + shift, durationFrames: item.span.durationFrames } } as SequenceItemInput;
  }
  return null;
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

/** 删了再写回会丢掉的关联，一样一句；没有时空的。 */
export function replaceSideEffects(plan: AssetReplacePlan): string[] {
  if (!plan.ok) return [];
  const out: string[] = [];
  if (plan.transitions) out.push(M.transitions(plan.transitions));
  if (plan.captions) out.push(M.captions(plan.captions));
  if (plan.ducking) out.push(M.ducking(plan.ducking));
  return out;
}
