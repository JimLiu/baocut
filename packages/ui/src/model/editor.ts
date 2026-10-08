import {
  defineMessages,
  framesToSeconds,
  itemRangeSeconds,
  sequenceDurationFrames,
  type AssetRecord,
  type DocumentRecord,
  type Id,
  type VideoSnapshot,
  type Rate,
  type Sequence,
  type SequenceItem,
  type Track,
  type VersionRef,
} from '@baocut/protocol';
import { transitionReach } from './transitions.ts';
import { zhHans } from './editor.zh-Hans.ts';
import { zhHant } from './editor.zh-Hant.ts';
import { ja } from './editor.ja.ts';
import { ko } from './editor.ko.ts';
import { es } from './editor.es.ts';
import { fr } from './editor.fr.ts';
import { de } from './editor.de.ts';
import { nl } from './editor.nl.ts';
import { ptBR } from './editor.pt-BR.ts';
import { it } from './editor.it.ts';
import { ru } from './editor.ru.ts';
import { pl } from './editor.pl.ts';
import { tr } from './editor.tr.ts';
import { vi } from './editor.vi.ts';

type ElementName = 'sticker' | 'placeholder' | 'whiteboard' | 'progress' | 'visualizer' | 'confetti' | 'draw';

/** 编辑器模型的文案（英文是键与类型的来源，译文在 `editor.zh-Hans.ts`）。 */
const en = {
  trackKind: { visual: 'Visual', audio: 'Audio', subtitle: 'Subtitles' } as Record<Track['kind'], string>,
  counter: 'Counter',
  text: 'Text',
  shape: 'Shape',
  composition: 'Composition',
  caption: 'Subtitles',
  asset: 'Asset',
  elements: {
    sticker: 'Sticker',
    placeholder: 'Placeholder',
    whiteboard: 'Whiteboard',
    progress: 'Progress bar',
    visualizer: 'Waveform',
    confetti: 'Confetti',
    draw: 'Drawing',
  } as Record<ElementName, string>,
  seconds: (value: string) => `${value} sec`,
};
export type EditorMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 编辑器的纯模型：时间线的几何、命中、吸附。预览在某个时刻画什么由 Rust 的帧计划决定（`render/`）。
 * 这里的秒只用于显示与命中；提交给引擎的时间用帧（拖动、拆分）或十进制秒字符串（输入框），见产品设计 §5.8。
 */

export interface TrackRow {
  track: Track;
  /** 行头上的名字：类别（画面、音频、字幕），有名字的接「 · 名字」，同类不止一条且没有名字的按顺序编号。 */
  label: string;
}


/** 视频引擎给默认轨道起的「V1」「A1」这类代号不算名字，行头只写类别。 */
const TRACK_CODE = /^[VAS]\d+$/;

function labelled(tracks: Track[]): TrackRow[] {
  return tracks.map((track, i) => {
    const kind = M.trackKind[track.kind];
    const name = track.name && !TRACK_CODE.test(track.name) ? track.name : null;
    const label = name ? `${kind} · ${name}` : tracks.length > 1 ? `${kind} ${i + 1}` : kind;
    return { track, label };
  });
}

/**
 * 时间线上的轨道行：字幕轨道在最上面（字幕画在画面之上），然后是视觉轨道（序号大的在更上面，与画面的叠放一致），
 * 音频轨道在下。
 */
export function trackRows(sequence: Sequence): TrackRow[] {
  const byOrder = [...sequence.tracks].sort((a, b) => a.order - b.order);
  const subtitle = labelled(byOrder.filter((t) => t.kind === 'subtitle'));
  const visual = labelled(byOrder.filter((t) => t.kind === 'visual'));
  const audio = labelled(byOrder.filter((t) => t.kind === 'audio'));
  return [...subtitle.reverse(), ...visual.reverse(), ...audio];
}

export function rootSequence(video: VideoSnapshot): Sequence | null {
  return video.sequences[video.rootSequenceId] ?? null;
}

/** 实例在序列上的区间（帧，音频可以有小数部分）。 */
export function itemFrames(item: SequenceItem, fps: Rate): { start: number; end: number } {
  if (item.type === 'audio') {
    const { start, end } = itemRangeSeconds(item, fps);
    return { start: (start * fps.num) / fps.den, end: (end * fps.num) / fps.den };
  }
  return { start: item.span.fromFrame, end: item.span.fromFrame + item.span.durationFrames };
}

export function durationSeconds(sequence: Sequence): number {
  return framesToSeconds(sequenceDurationFrames(sequence), sequence.fps);
}

/**
 * 走带播放键的三态：在播是暂停；停着且播放头到了片尾（差不到 0.05 秒）是重播，否则是播放（原型 model-player.js `playButtonState`）。
 * 空时间线（时长为 0）无所谓片尾，显示播放。
 */
export type PlayButtonState = 'play' | 'pause' | 'replay';

export function playButtonState(state: { playing: boolean; playhead: number; duration: number }): PlayButtonState {
  const { playing, playhead, duration } = state;
  if (playing) return 'pause';
  if (!(duration > 0)) return 'play';
  return playhead >= duration - 0.05 ? 'replay' : 'play';
}

/** 秒落到哪一帧（向下取整，帧的起点）。 */
export function frameAt(seconds: number, fps: Rate): number {
  return Math.max(0, Math.floor((seconds * fps.num) / fps.den + 1e-6));
}

export function nearestFrame(seconds: number, fps: Rate): number {
  return Math.max(0, Math.round((seconds * fps.num) / fps.den));
}

/**
 * 预览要给每个视频素材准备几个元素：同一帧上用到它的（启用的）实例最多有几个。
 * 同一素材出现在两条轨道上、或者叠在一起时，各自要定位到不同的源时刻。
 * 用到视频素材的除了视频实例，还有带预渲染替身的合成实例：帧计划把它当视频层给出来，素材是替身。
 * 两侧转场里实例在自己的区间之外也要画（拆开的两段之间叠化时，同一素材同时要两个源时刻），区间按转场窗口放宽。
 */
export function videoSlots(sequence: Sequence): { asset: VersionRef; count: number }[] {
  const spans = new Map<string, { asset: VersionRef; edges: [number, number][] }>();
  const reach = transitionReach(sequence);
  for (const item of sequence.items) {
    if ((item.type !== 'video' && item.type !== 'composition') || !item.enabled) continue;
    const asset = item.type === 'video' ? item.assetRef : item.prerender;
    if (!asset) continue;
    const key = `${asset.id}:${asset.revision}`;
    const entry = spans.get(key) ?? { asset, edges: [] };
    const [from, to] = reach.get(item.id) ?? [item.span.fromFrame, item.span.fromFrame + item.span.durationFrames];
    entry.edges.push([from, 1], [to, -1]);
    spans.set(key, entry);
  }
  return [...spans.values()].map(({ asset, edges }) => {
    // 同一帧上先结束再开始：首尾相接的两段共用一个元素。
    edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    let open = 0;
    let count = 0;
    for (const [, delta] of edges) count = Math.max(count, (open += delta));
    return { asset, count };
  });
}

/** 吸附：在阈值（帧）内找最近的目标。没有时返回原值。 */
export function snapFrame(frame: number, targets: readonly number[], threshold: number): { frame: number; snapped: number | null } {
  let best: number | null = null;
  for (const target of targets) {
    if (Math.abs(target - frame) <= threshold && (best === null || Math.abs(target - frame) < Math.abs(best - frame))) best = target;
  }
  return best === null ? { frame, snapped: null } : { frame: best, snapped: best };
}

/** 吸附目标：播放头、序列起点，以及（除了正在拖的）所有实例的两端。 */
export function snapTargets(sequence: Sequence, playheadFrame: number, exclude: ReadonlySet<string>): number[] {
  const targets = new Set<number>([0, playheadFrame]);
  for (const item of sequence.items) {
    if (exclude.has(item.id)) continue;
    const { start, end } = itemFrames(item, sequence.fps);
    targets.add(Math.round(start));
    targets.add(Math.round(end));
  }
  return [...targets];
}

/** 实例能否放上这条轨道（与引擎一致）：音频只进音频轨道，字幕只进字幕轨道，其余（视频、图片、文字、图形、合成）只进视觉轨道。 */
export function trackAccepts(track: Track, item: { type: SequenceItem['type'] }): boolean {
  if (item.type === 'audio') return track.kind === 'audio';
  if (item.type === 'caption') return track.kind === 'subtitle';
  return track.kind === 'visual';
}

/** 实例在时间线与检查器里显示的名字：自己的名字优先，否则按内容取（文字、素材名、生成器名、字幕文档名）。 */
export function itemLabel(item: SequenceItem, assets: Record<Id, AssetRecord>, documents: Record<Id, DocumentRecord>): string {
  if (item.name) return item.name;
  switch (item.type) {
    case 'text':
      if (item.counter) return M.counter;
      return (item.text ?? '').replace(/\s+/g, ' ').trim() || M.text;
    case 'shape':
      return M.shape;
    case 'composition':
      return assets[item.source.assetRef.id]?.name ?? M.composition;
    case 'caption':
      return documents[item.documentId]?.name ?? M.caption;
    case 'sticker':
    case 'placeholder':
    case 'whiteboard':
      return (item.assetRef && assets[item.assetRef.id]?.name) || M.elements[item.type];
    case 'progress':
    case 'visualizer':
    case 'confetti':
    case 'draw':
      return M.elements[item.type];
    default:
      return assets[item.assetRef.id]?.name ?? M.asset;
  }
}

/** 时间线块按什么上色、配哪个图标（同旧版网页时间线的 `elementHue` / `elementIcon`）：带计时读数的文字算计数器。 */
export type ClipKind = SequenceItem['type'] | 'counter';

export function clipKind(item: SequenceItem): ClipKind {
  if (item.type === 'text' && item.counter) return 'counter';
  return item.type;
}

/** 时间线刻度的间隔（秒）：让相邻两个标注之间至少有 `minPx` 像素。 */
export function rulerStep(pxPerSecond: number, minPx = 72): { major: number; minor: number } {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const major = steps.find((s) => s * pxPerSecond >= minPx) ?? 3600;
  const minor = major >= 60 ? major / 6 : major >= 1 ? major / 5 : major / 2;
  return { major, minor };
}

/** 刻度标注：「0:05」「1:30」；小于一秒的间隔带一位小数。 */
export function rulerLabel(seconds: number, step: number): string {
  const whole = Math.floor(seconds + 1e-6);
  const m = Math.floor(whole / 60);
  const s = String(whole % 60).padStart(2, '0');
  if (step < 1) return `${m}:${s}.${Math.round((seconds - whole) * 10) % 10}`;
  return `${m}:${s}`;
}

/** 编辑器的时码：「00:00:05:12」（时:分:秒:帧）。帧号按序列的帧率，向下取整。 */
export function formatTimecode(seconds: number, fps: Rate): string {
  const perSecond = Math.max(1, Math.round(fps.num / fps.den));
  const frame = frameAt(seconds, fps);
  const totalSeconds = Math.floor((frame * fps.den) / fps.num + 1e-9);
  const ff = frame - Math.round((totalSeconds * fps.num) / fps.den);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(h)}:${two(m)}:${two(s)}:${two(Math.min(Math.max(ff, 0), perSecond - 1))}`;
}

/** 秒数显示到毫秒：「10.010 秒」。只是呈现；提交用精确值。 */
export function formatSeconds(seconds: number): string {
  return M.seconds(seconds.toFixed(3));
}

/** 帧率显示：「30 fps」「29.97 fps」。 */
export function formatFps(fps: Rate): string {
  const value = fps.num / fps.den;
  return `${Number.isInteger(value) ? value : value.toFixed(2)} fps`;
}

/** 解析用户输入的秒数：「10」「10.5」「1:05.2」。不合法时返回 null。返回十进制字符串，交给引擎量化。 */
export function parseSecondsInput(text: string): string | null {
  const trimmed = text.trim().replace(/秒$/, '').trim();
  const clock = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(trimmed);
  if (clock) {
    const seconds = Number(clock[1]) * 60 + Number(clock[2]);
    return Number.isFinite(seconds) ? trimDecimal(seconds) : null;
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return trimmed.replace(/^0+(?=\d)/, '');
}

function trimDecimal(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, '');
}
