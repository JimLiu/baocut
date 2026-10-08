import { defineMessages, framesToSeconds, type AssetRecord, type DocumentRecord, type ExportRange, type ExportScope, type Id, type Sequence, type VideoItem } from '@baocut/protocol';
import { durationSeconds, itemLabel, parseSecondsInput } from './editor.ts';
import { formatClock } from './format.ts';
import { zhHans } from './export-range.zh-Hans.ts';
import { zhHant } from './export-range.zh-Hant.ts';
import { ja } from './export-range.ja.ts';
import { ko } from './export-range.ko.ts';
import { es } from './export-range.es.ts';
import { fr } from './export-range.fr.ts';
import { de } from './export-range.de.ts';
import { nl } from './export-range.nl.ts';
import { ptBR } from './export-range.pt-BR.ts';
import { it } from './export-range.it.ts';
import { ru } from './export-range.ru.ts';
import { pl } from './export-range.pl.ts';
import { tr } from './export-range.tr.ts';
import { vi } from './export-range.vi.ts';

/** 导出范围的文案（英文是键与类型的来源，译文在 `export-range.zh-Hans.ts`）。 */
const en = {
  modeAll: 'Whole video',
  modeChapters: 'By chapter',
  modeClips: 'By clip',
  modeCustom: 'Custom',
  chapterN: (n: number) => `Chapter ${n}`,
  clipN: (n: number) => `Clip ${n}`,
  whole: (clock: string) => `Whole video ${clock}`,
  joined: (n: number, chapters: boolean, clock: string) =>
    `${n} ${chapters ? 'chapters' : 'segments'} joined into one · ${clock}`,
  separate: (n: number, clock: string) => `${n} segments · ${clock} total`,
};
export type ExportRangeMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 导出的范围（设计稿 export-range.jsx、model-export.js `spanOf` / `clampCustom` / `fmtT`）：整片 / 按章节 / 按片段 / 自定义，
 * 落成 `ExportScope` 的 `range` 或 `ranges`（架构设计 §9.13）。
 *
 * - 章节是序列上 `kind: 'chapter'` 的标记（视频格式规范 §3.13），到下一章（或标记自己的时长、片尾）为止。
 * - 片段是时间线上启用的视频实例（设计稿「片段 = 时间轴上的视频元素」），按起点排；停用的、所在轨道隐藏的不算。
 * - 勾选的几段里相邻的拼成一段；拼完还剩几段时，每段各出一个文件（`ranges`）。Runtime 不能把不相邻的几段接成一个文件，
 *   设计稿的「合成一份」在这时置灰，写明原因。
 * - 时间都是序列时间的秒；剪掉的部分本来就不在序列上，这里不再处理。
 */

export type RangeMode = 'all' | 'chapters' | 'clips' | 'custom';

export const RANGE_MODES: readonly { key: RangeMode; label: string }[] = [
  {
    key: 'all',
    get label() {
      return M.modeAll;
    },
  },
  {
    key: 'chapters',
    get label() {
      return M.modeChapters;
    },
  },
  {
    key: 'clips',
    get label() {
      return M.modeClips;
    },
  },
  {
    key: 'custom',
    get label() {
      return M.modeCustom;
    },
  },
];

/** 自定义范围最短多少秒（设计稿 `clampCustom`）。 */
export const MIN_CUSTOM_SECONDS = 0.5;

/** 可以勾的一段：一章，或一个视频实例。 */
export interface RangePiece {
  id: Id;
  /** 列表上的名字：章名，或「片段 N」。 */
  label: string;
  /** 片段的素材名（列表第二行）；章节没有。 */
  name: string | null;
  start: number;
  end: number;
}

export interface RangeState {
  mode: RangeMode;
  chapterIds: Id[];
  clipIds: Id[];
  custom: ExportRange;
}

/** 这次导出实际覆盖的范围。 */
export interface RangePlan {
  /** 整片：不带 `range` / `ranges`。 */
  whole: boolean;
  /** 拼好的几段（整片时是整条序列的一段）。 */
  segments: ExportRange[];
  /** 选了章节或片段、却一段都没勾。 */
  empty: boolean;
  /** 合计秒数。 */
  seconds: number;
  /** 摘要里的一句：「整片 3:26」「第 2 章 · 0:45」「3 段 · 共 1:10」「0:45.0–1:18.0」。 */
  label: string;
}

const EPS = 1e-3;

/** 序列上的章节：按帧排，到下一章（或自己的时长、片尾）为止；落在片尾之外的不算。 */
export function chapterPieces(sequence: Sequence): RangePiece[] {
  const total = durationSeconds(sequence);
  const markers = sequence.markers.filter((m) => m.kind === 'chapter').sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id));
  const out: RangePiece[] = [];
  markers.forEach((marker, i) => {
    const start = framesToSeconds(marker.frame, sequence.fps);
    const next = markers[i + 1];
    const own = marker.durationFrames ? framesToSeconds(marker.frame + marker.durationFrames, sequence.fps) : null;
    const end = Math.min(total, own ?? (next ? framesToSeconds(next.frame, sequence.fps) : total));
    if (end - start > EPS) out.push({ id: marker.id, label: marker.label.trim() || M.chapterN(i + 1), name: null, start, end });
  });
  return out;
}

/** 时间线上的视频片段：启用的视频实例，所在轨道没有隐藏；按起点排，名字是「片段 N」加素材名。 */
export function clipPieces(sequence: Sequence, assets: Record<Id, AssetRecord>, documents: Record<Id, DocumentRecord>): RangePiece[] {
  const hidden = new Set(sequence.tracks.filter((t) => !t.visible).map((t) => t.id));
  return sequence.items
    .filter((item): item is VideoItem => item.type === 'video' && item.enabled && !hidden.has(item.trackId))
    .map((item) => ({
      id: item.id,
      name: itemLabel(item, assets, documents),
      start: framesToSeconds(item.span.fromFrame, sequence.fps),
      end: framesToSeconds(item.span.fromFrame + item.span.durationFrames, sequence.fps),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((p, i) => ({ ...p, label: M.clipN(i + 1) }));
}

/** 起止夹进 `[0, 总长]`，至少 `MIN_CUSTOM_SECONDS` 长（片子本身更短时就是整片）。 */
export function clampCustom(start: number, end: number, duration: number): ExportRange {
  const total = Math.max(0, duration);
  if (total <= MIN_CUSTOM_SECONDS) return { start: 0, end: total };
  const s = Math.min(Math.max(0, Number.isFinite(start) ? start : 0), total - MIN_CUSTOM_SECONDS);
  const e = Math.max(Math.min(total, Number.isFinite(end) ? end : total), s + MIN_CUSTOM_SECONDS);
  return { start: s, end: e };
}

/** 勾选的几段按起点排好，相邻（或重叠）的拼成一段。 */
export function mergeSegments(pieces: readonly ExportRange[]): ExportRange[] {
  const sorted = [...pieces].sort((a, b) => a.start - b.start);
  const out: ExportRange[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && p.start <= last.end + EPS) last.end = Math.max(last.end, p.end);
    else out.push({ start: p.start, end: p.end });
  }
  return out;
}

/** 列表与修剪条上的时间：「1:05.3」（设计稿 `fmtT`，向下截断到 0.1 秒）。 */
export function formatRangeTime(seconds: number): string {
  return formatClock(seconds, { tenths: true });
}

/** 解析时间码输入：「65」「65.3」「1:05.3」；不合法时 null。 */
export function parseRangeTime(text: string): number | null {
  const parsed = parseSecondsInput(text);
  if (parsed === null) return null;
  const value = Number(parsed);
  return Number.isFinite(value) ? value : null;
}

const total = (segments: readonly ExportRange[]) => segments.reduce((sum, s) => sum + (s.end - s.start), 0);

/** 当前取舍 → 这次导出的范围。 */
export function rangePlan(state: RangeState, chapters: readonly RangePiece[], clips: readonly RangePiece[], duration: number): RangePlan {
  if (state.mode === 'all') {
    return { whole: true, segments: [{ start: 0, end: duration }], empty: duration <= 0, seconds: duration, label: M.whole(formatClock(duration)) };
  }
  if (state.mode === 'custom') {
    const c = clampCustom(state.custom.start, state.custom.end, duration);
    return {
      whole: false,
      segments: [c],
      empty: c.end - c.start <= 0,
      seconds: c.end - c.start,
      label: `${formatRangeTime(c.start)}–${formatRangeTime(c.end)}`,
    };
  }
  const pieces = state.mode === 'chapters' ? chapters : clips;
  const ids = new Set(state.mode === 'chapters' ? state.chapterIds : state.clipIds);
  const picked = pieces.filter((p) => ids.has(p.id));
  const segments = mergeSegments(picked);
  const seconds = total(segments);
  if (!segments.length) return { whole: false, segments: [], empty: true, seconds: 0, label: '' };
  const label =
    picked.length === 1
      ? `${picked[0]!.label} · ${formatClock(seconds)}`
      : segments.length === 1
        ? M.joined(picked.length, state.mode === 'chapters', formatClock(seconds))
        : M.separate(segments.length, formatClock(seconds));
  return { whole: false, segments, empty: false, seconds, label };
}

/** 范围 → `ExportScope`：整片不带；一段是 `range`；几段是 `ranges`（每段各出一个文件）。 */
export function rangeScope(plan: RangePlan): Pick<ExportScope, 'range' | 'ranges'> {
  if (plan.whole || plan.empty) return {};
  if (plan.segments.length === 1) return { range: { ...plan.segments[0]! } };
  return { ranges: plan.segments.map((s) => ({ ...s })) };
}

/** 播放头所在的那一段（章节默认勾这一章，片段默认勾选中的那段、没选就勾播放头下的）。 */
export function pieceAt(pieces: readonly RangePiece[], seconds: number): RangePiece | null {
  return pieces.find((p) => seconds >= p.start - EPS && seconds < p.end - EPS) ?? null;
}

/** 弹层打开时的范围：整片；章节与片段预先勾好播放头（或选中）的那一段，自定义从整片开始。 */
export function initialRange(chapters: readonly RangePiece[], clips: readonly RangePiece[], playhead: number, selection: readonly Id[], duration: number): RangeState {
  const chapter = pieceAt(chapters, playhead);
  const selected = clips.find((c) => selection.includes(c.id)) ?? pieceAt(clips, playhead);
  return {
    mode: 'all',
    chapterIds: chapter ? [chapter.id] : [],
    clipIds: selected ? [selected.id] : [],
    custom: clampCustom(0, duration, duration),
  };
}

/** 勾 / 取消一段。 */
export function toggleId(ids: readonly Id[], id: Id): Id[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}
