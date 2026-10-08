import {
  defineMessages,
  isVisualItem,
  onLocaleChange,
  sequenceDurationFrames,
  type EditOperation,
  type Id,
  type MediaTime,
  type Sequence,
  type SequenceItem,
  type SequenceItemInput,
  type Track,
  type Place,
  type VisualItem,
} from '@baocut/protocol';
import { itemFrames, trackAccepts } from './editor.ts';
import { posable, poseOf } from './stage-pose.ts';
import { zhHans } from './item-clipboard.zh-Hans.ts';
import { zhHant } from './item-clipboard.zh-Hant.ts';
import { ja } from './item-clipboard.ja.ts';
import { ko } from './item-clipboard.ko.ts';
import { es } from './item-clipboard.es.ts';
import { fr } from './item-clipboard.fr.ts';
import { de } from './item-clipboard.de.ts';
import { nl } from './item-clipboard.nl.ts';
import { ptBR } from './item-clipboard.pt-BR.ts';
import { it } from './item-clipboard.it.ts';
import { ru } from './item-clipboard.ru.ts';
import { pl } from './item-clipboard.pl.ts';
import { tr } from './item-clipboard.tr.ts';
import { vi } from './item-clipboard.vi.ts';

/** 副本名字的文案（英文是键与类型的来源，译文在 `item-clipboard.zh-Hans.ts`）。 */
const en = {
  copySuffix: ' · Copy',
};
export type ItemClipboardMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 时间线的复制、粘贴与再制（原型 editor-keys.jsx 的 spawn、model-select.js 的 pasteSpan / pasteOffset）。
 *
 * 剪贴板里放的是复制那一刻的片段快照；粘贴把它们换成一笔 `insertItems`（缺轨道时同一笔里先 `addTrack`）。
 * 引擎管的字段（id、lineage、启用、锁定、叠放次序、跟随）与联动组不带过去，副本是一件全新的、启用的片段。
 */

/** 每粘贴一次，画面上的副本再错开画幅的 2%（原型 PASTE_STEP）。 */
export const PASTE_STEP = 2;
/** 副本中心的限位（画幅百分比，原型 LIMITS）：错开不能把它推出画面。 */
export const PASTE_LIMITS = { x: [3, 97], y: [4, 96] } as const;
/** 副本名字的后缀；再复制副本时不叠成「· 副本 · 副本」。 */
export let COPY_SUFFIX: string = M.copySuffix;
onLocaleChange(() => {
  COPY_SUFFIX = M.copySuffix;
});

/** 片段所在的时间（帧）：音频可以落在帧之间，其余都在帧上。 */
interface Frames {
  start: number;
  end: number;
}

/**
 * 副本落在哪段时间（原型 pasteSpan）：播放头在源片段的时段里（两端都算）就原地粘；
 * 在外面就搬到播放头、保持长度，起点夹在 [0, 片长 − 长度] 里。返回新的起点（帧），原地时原样返回。
 */
export function pasteStart(range: Frames, playheadFrame: number, durationFrames: number): number {
  if (playheadFrame >= range.start - 1e-6 && playheadFrame <= range.end + 1e-6) return range.start;
  const length = range.end - range.start;
  const latest = Math.max(0, Math.floor(durationFrames - length + 1e-6));
  return Math.min(Math.max(0, playheadFrame), latest);
}

const roundTo = (value: number, k: number) => {
  const r = (Math.sign(value) * Math.round(Math.abs(value) * k)) / k;
  return r === 0 ? 0 : r;
};

/** 一条轴上错开：原本就在限位外的（大半出画的视频）不动，免得被拉回画面里。 */
function shiftAxis(center: number, step: number, [lo, hi]: readonly [number, number]): number {
  if (center < lo - 1e-6 || center > hi + 1e-6) return center;
  return roundTo(Math.min(hi, Math.max(lo, center + step)), 10);
}

/**
 * 副本的 `place`（原型 pasteOffset）：框中心按画幅百分比往右下错开 `PASTE_STEP × generation`，夹在限位里；
 * 大小与角度不变。铺满画布的（框不看位置）原样不动。
 */
export function pastePlace(item: VisualItem, canvas: { width: number; height: number }, generation: number): Place {
  const { width: W, height: H } = canvas;
  const step = PASTE_STEP * generation;
  if (W <= 0 || H <= 0 || step === 0 || !posable(item, canvas)) return item.place;
  const pose = poseOf(item, canvas);
  const cx = (pose.cx / W) * 100;
  const cy = (pose.cy / H) * 100;
  const nx = shiftAxis(cx, step, PASTE_LIMITS.x);
  const ny = shiftAxis(cy, step, PASTE_LIMITS.y);
  return { ...item.place, ...(nx !== cx ? { x: nx } : {}), ...(ny !== cy ? { y: ny } : {}) };
}

/** 副本的名字：去掉已有的「· 副本」再加一次。 */
export function copyName(name: string): string {
  return `${name.endsWith(COPY_SUFFIX) ? name.slice(0, -COPY_SUFFIX.length) : name}${COPY_SUFFIX}`;
}

/** 放进哪条轨道：已有的，或同一笔事务里新建的那条（`ref`）。 */
type Slot = { trackId: Id } | { trackRef: string };

export interface PastePlan {
  operations: EditOperation[];
  /** 粘贴了几件。 */
  count: number;
}

export interface PasteOptions {
  /** 播放头在哪一帧。 */
  playheadFrame: number;
  /** 这是本次会话的第几次粘贴（含再制），决定画面上错开多少。 */
  generation: number;
  /** 片段没有自己的名字时显示的名字（素材名、生成器名……），副本拿它加「· 副本」。 */
  labelOf(item: SequenceItem): string;
}

const ZERO = (timescale: number): MediaTime => ({ ticks: '0', timescale });

/**
 * 把剪贴板里的片段粘回序列：一笔事务，整批一条撤销记录（原型 spawn）。
 *
 * 时间按 `pasteStart`，各件各算。轨道：源轨道在落点空着（算上这一批已经放下的）、没锁、类型对得上就放回原轨；
 * 否则找它上面第一条空着的同类轨道（副本压在原件上面才看得见）；都不行就在最上面新建一条。
 * 文字没有自己的名字时不起名：时间线上照旧显示正文，改了正文也跟着变。
 */
export function pasteOperations(sequence: Sequence, entries: readonly SequenceItem[], options: PasteOptions): PastePlan {
  if (!entries.length) return { operations: [], count: 0 };
  const fps = sequence.fps;
  const duration = sequenceDurationFrames(sequence);
  const tracks = [...sequence.tracks].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const byId = new Map(tracks.map((track) => [track.id, track]));
  // 这一批已经放下的（按轨道或 ref 记）：后面的副本不能叠上去。
  const placed = new Map<string, Frames[]>();
  const created: { ref: string; kind: Track['kind'] }[] = [];
  const operations: EditOperation[] = [];
  const items: SequenceItemInput[] = [];

  const free = (key: string, trackId: Id | null, range: Frames) => {
    const clash = (other: Frames) => other.end > range.start + 1e-6 && other.start < range.end - 1e-6;
    if ((placed.get(key) ?? []).some(clash)) return false;
    if (!trackId) return true;
    return sequence.items.every((item) => item.trackId !== trackId || !clash(itemFrames(item, fps)));
  };

  for (const entry of entries) {
    const source = itemFrames(entry, fps);
    const start = pasteStart(source, options.playheadFrame, duration);
    const range = { start, end: start + (source.end - source.start) };
    const usable = (track: Track | undefined): track is Track => !!track && !track.locked && trackAccepts(track, entry);
    const home = byId.get(entry.trackId);
    let slot: Slot | null = null;
    if (usable(home) && free(home.id, home.id, range)) slot = { trackId: home.id };
    if (!slot) {
      const floor = home?.order ?? Number.NEGATIVE_INFINITY;
      const above = tracks.find((track) => track.order > floor && track.visible && usable(track) && free(track.id, track.id, range));
      if (above) slot = { trackId: above.id };
    }
    if (!slot) {
      const kind: Track['kind'] = entry.type === 'audio' ? 'audio' : entry.type === 'caption' ? 'subtitle' : 'visual';
      const fresh = created.find((track) => track.kind === kind && free(track.ref, null, range));
      if (fresh) slot = { trackRef: fresh.ref };
      else {
        const ref = `paste-track-${created.length}`;
        created.push({ ref, kind });
        operations.push({ type: 'addTrack', sequenceId: sequence.id, kind, ref });
        slot = { trackRef: ref };
      }
    }
    const key = 'trackId' in slot ? slot.trackId : slot.trackRef;
    placed.set(key, [...(placed.get(key) ?? []), range]);
    items.push(pasteInput(entry, slot, start, source.start, sequence, options));
  }
  operations.push({ type: 'insertItems', sequenceId: sequence.id, items });
  return { operations, count: items.length };
}

/** 一件副本的字段：去掉引擎管的与联动组，换时间、轨道、名字与画面上的位置。 */
function pasteInput(entry: SequenceItem, slot: Slot, start: number, sourceStart: number, sequence: Sequence, options: PasteOptions): SequenceItemInput {
  const { id: _id, lineage: _lineage, trackId: _track, enabled: _enabled, locked: _locked, paintOrder: _order, followPolicy: _follow, linkGroupId: _link, ...rest } =
    entry;
  const fields: Record<string, unknown> = { ...rest, ...slot };
  if (entry.name || entry.type !== 'text') fields.name = copyName(entry.name || options.labelOf(entry));
  if (isVisualItem(entry)) fields.place = pastePlace(entry, sequence.canvas, options.generation);
  if (entry.type === 'audio') {
    // 原地粘贴保留帧内偏移；搬到播放头时落在帧上。
    if (start !== sourceStart) {
      fields.fromFrame = Math.round(start);
      fields.subframeOffset = ZERO(entry.subframeOffset.timescale);
    }
  } else {
    fields.span = { fromFrame: Math.round(start), durationFrames: entry.span.durationFrames };
  }
  return fields as unknown as SequenceItemInput;
}
