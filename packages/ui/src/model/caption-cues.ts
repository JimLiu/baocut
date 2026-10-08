import type { CaptionItem, Sequence, SequenceItem } from '@baocut/protocol';
import type { CaptionTrack } from '../render/captions.ts';
import { itemFrames } from './editor.ts';

/** 投到序列上的一句字幕（秒）。同一句经两个作用实例出现两次时 `key` 不同，`cueId` 相同。 */
export interface PlacedCue {
  key: string;
  cueId: string;
  start: number;
  end: number;
  text: string;
}

/** `interval` 扣掉 `taken` 里的区间之后剩下的部分（按先后）。 */
function subtract(interval: [number, number], taken: ReadonlyArray<[number, number]>): Array<[number, number]> {
  let parts = [interval];
  for (const [a, b] of taken) {
    const next: Array<[number, number]> = [];
    for (const [x, y] of parts) {
      if (b <= x || a >= y) {
        next.push([x, y]);
        continue;
      }
      if (a > x) next.push([x, a]);
      if (b < y) next.push([b, y]);
    }
    parts = next;
  }
  return parts;
}

/**
 * 字幕实例的句子在序列上的位置（时间线用）。有作用实例时只在它们覆盖的区间里出现（与 render-graph 一致）：
 * 文档在源素材时钟上时经实例的时间映射投过去，落在哪个实例的源区间里就出现在那个实例下面，剪掉的部分不出现；
 * 作用实例一个都找不到（都删了）时什么也不出现。没有作用实例时文档时间就是序列时间。
 * 作用实例按列出的次序各占别人没占的区间（text_plan.rs 的 `caption-items`），链在一起的音视频不出两份。
 * 结果按开始时刻排好，裁在字幕实例自己的区间里。
 */
export function placeCues(item: CaptionItem, sequence: Sequence, track: CaptionTrack): PlacedCue[] {
  const perSecond = sequence.fps.num / sequence.fps.den;
  const spanStart = item.span.fromFrame / perSecond;
  const spanEnd = (item.span.fromFrame + item.span.durationFrames) / perSecond;
  const cues = [...track.cues].filter((cue) => cue.text.trim() !== '').sort((a, b) => a.start - b.start);
  const placed: PlacedCue[] = [];
  const seen = new Map<string, number>();
  const push = (prefix: string, cueId: string, start: number, end: number, text: string, from: number, to: number) => {
    const a = Math.max(start, from);
    const b = Math.min(end, to);
    if (!(b > a)) return;
    const base = `${prefix}${cueId}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    placed.push({ key: n === 1 ? base : `${base}#${n}`, cueId, start: a, end: b, text });
  };

  const byId = new Map(sequence.items.map((other) => [other.id, other]));
  const scopeIds = item.scopeItemIds ?? [];
  if (scopeIds.length === 0) {
    for (const cue of cues) push('', cue.id, cue.start, cue.end, cue.text, spanStart, spanEnd);
    return placed;
  }
  const taken: Array<[number, number]> = [];
  for (const id of scopeIds) {
    const scope = byId.get(id);
    if (!scope || (scope.type !== 'video' && scope.type !== 'audio' && scope.type !== 'composition')) continue;
    if (scope.timeMap.kind !== 'linear') continue;
    const range = itemFrames(scope, sequence.fps);
    const seqStart = range.start / perSecond;
    const seqEnd = range.end / perSecond;
    const sourceIn = Number(scope.timeMap.sourceIn.ticks) / scope.timeMap.sourceIn.timescale;
    const rate = scope.timeMap.rate.num / scope.timeMap.rate.den;
    if (!(rate > 0)) continue;
    const from = Math.max(seqStart, spanStart);
    const to = Math.min(seqEnd, spanEnd);
    if (!(to > from)) continue;
    const windows = subtract([from, to], taken);
    taken.push([from, to]);
    for (const [a, b] of windows) {
      for (const cue of cues) {
        if (track.clock === 'sequence') push(`${scope.id}:`, cue.id, cue.start, cue.end, cue.text, a, b);
        else push(`${scope.id}:`, cue.id, seqStart + (cue.start - sourceIn) / rate, seqStart + (cue.end - sourceIn) / rate, cue.text, a, b);
      }
    }
  }
  return placed.sort((a, b) => a.start - b.start);
}

const placedCache = new WeakMap<CaptionTrack, WeakMap<Sequence, WeakMap<CaptionItem, readonly PlacedCue[]>>>();

/**
 * `placeCues` 的缓存版：按字幕文档（`readCaptions` 按正文缓存，同一版本是同一个对象）、序列版本与实例记在组件外，
 * 字幕面板与时间线共用，切面板重新挂载时不再整遍重排。三者都是不可变快照，任何一个换了就是新的一份。
 */
export function placedCues(item: CaptionItem, sequence: Sequence, track: CaptionTrack): readonly PlacedCue[] {
  let bySequence = placedCache.get(track);
  if (!bySequence) placedCache.set(track, (bySequence = new WeakMap()));
  let byItem = bySequence.get(sequence);
  if (!byItem) bySequence.set(sequence, (byItem = new WeakMap()));
  let placed = byItem.get(item);
  if (!placed) byItem.set(item, (placed = placeCues(item, sequence, track)));
  return placed;
}
