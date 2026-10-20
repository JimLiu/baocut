import type { Id } from '@baocut/protocol';
import { visibleChapters, type ChapterSpan } from './chapters.ts';
import { sentenceEnd } from './speech-cues.ts';
import type { TranscriptWord } from './transcript-cut.ts';
import { paragraphText } from './transcript-text.ts';
import { defineMessages } from '@baocut/protocol';
import { zhHans } from './lite-segments.zh-Hans.ts';
import { zhHant } from './lite-segments.zh-Hant.ts';
import { ja } from './lite-segments.ja.ts';
import { ko } from './lite-segments.ko.ts';
import { es } from './lite-segments.es.ts';
import { fr } from './lite-segments.fr.ts';
import { de } from './lite-segments.de.ts';
import { nl } from './lite-segments.nl.ts';
import { ptBR } from './lite-segments.pt-BR.ts';
import { it } from './lite-segments.it.ts';
import { ru } from './lite-segments.ru.ts';
import { pl } from './lite-segments.pl.ts';
import { tr } from './lite-segments.tr.ts';
import { vi } from './lite-segments.vi.ts';

/**
 * 轻量视图的段（轻量编辑器设计 §2；原型 designs/baocut/app/model-lite.js）：同一部视频折成一串首尾相接的段，
 * 是片条的一片、侧栏的一页、上一段 / 下一段的落点。纯函数，无 React、无 DOM。
 *
 * 来源按优先级取第一个命中的，不混用：序列上的 `chapter` 标记（`chapter`）→ 按旁白的停顿分组的句（`speech`）→ 整条（`whole`）。
 * 设计稿第一优先级「章节表的场景」：章节表的章编译成 `chapter` 标记，这里照章节显示；章节表里这一章的脚本（`scripts`，按标记 ID，
 * `model/chapter-sheet.ts`）挂在那一段上。场景状态与素材清单要等章节表的编译落地（§10 第 2 阶段）。
 *
 * 段的 `start` / `end` 是序列秒数；逐句 `lines` 同样是序列秒数（文稿词的落位 `placements[0]`），有译文时另算（§10 第 2 阶段）。
 */

const en = {
  segmentN: (n: number) => `Segment ${n}`,
};
export type LiteSegmentsMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

export type EditorView = 'lite' | 'timeline';
/** 偏好「默认打开」：按视频种类、总是轻量、总是时间线。 */
export type EditorViewDefault = 'auto' | EditorView;
export const EDITOR_VIEWS: readonly EditorView[] = ['lite', 'timeline'];

export function isEditorView(value: unknown): value is EditorView {
  return value === 'lite' || value === 'timeline';
}

export type LiteSource = 'chapter' | 'speech' | 'whole';

export interface LiteLine {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface LiteSegment {
  id: string;
  index: number;
  source: LiteSource;
  title: string;
  start: number;
  end: number;
  lines: LiteLine[];
  /** 章节表里这一章的脚本 Markdown（只有章节段、且章节表编译到了这个标记时有）。 */
  script?: string;
}

/** 旁白分段：相邻两句间隔不小于这么多秒就断开；一段累计不超过这么多秒（超过就在下一句前断）。 */
export const LITE_SPEECH_GAP = 1.8;
export const LITE_SPEECH_MAX = 60;
/** 段首句取前几个字作标题。 */
const TITLE_CHARS = 24;
/** 上一段 / 下一段的容差（秒），与章节的 `prevChapterStart` 同一个值。 */
const NEAR = 0.05;

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * 文稿的词折成逐句：标了段首、换了说话人、句子 ID 变了（识别器给了句子时）或句末标点 / 停顿超过 1 秒处断开。
 * 只收落到序列上、没剪掉的词；时间按第一处落位（同一个词在序列上出现多处时只认最早的一处）。
 */
export function speechLines(words: readonly TranscriptWord[]): LiteLine[] {
  const lines: LiteLine[] = [];
  let current: TranscriptWord[] = [];
  const flush = () => {
    if (!current.length) return;
    const first = current[0]!;
    const last = current[current.length - 1]!;
    const text = paragraphText(current).text;
    if (text) lines.push({ id: `line-${first.id}`, start: round3(first.placements[0]!.start), end: round3(last.placements[0]!.end), text });
    current = [];
  };
  for (const word of words) {
    const at = word.placements[0];
    if (word.state === 'cut' || !at) continue;
    const last = current[current.length - 1];
    if (last && breaksLine(last, word)) flush();
    current.push(word);
  }
  flush();
  return lines.sort((a, b) => a.start - b.start);
}

function breaksLine(last: TranscriptWord, next: TranscriptWord): boolean {
  if (next.paragraphStart) return true;
  if ((last.speaker ?? null) !== (next.speaker ?? null)) return true;
  if (last.sentenceId !== undefined || next.sentenceId !== undefined) return last.sentenceId !== next.sentenceId;
  return next.placements[0]!.start - last.placements[0]!.end > 1 || sentenceEnd(last.text.trim());
}

/** 落在 [start, end) 里的句（按句中点归段，与文稿按章分组同一规则）。 */
function linesIn(lines: readonly LiteLine[], start: number, end: number): LiteLine[] {
  return lines.filter((l) => {
    const mid = (l.start + l.end) / 2;
    return mid >= start && mid < end;
  });
}

/** 一部视频折成一串段。优先级：章节标记 → 旁白分段 → 整条。 */
export function liteSegments(input: {
  chapters: readonly ChapterSpan[];
  lines: readonly LiteLine[];
  duration: number;
  title: string;
  /** 章节标记 ID → 章节表里那一章的脚本。 */
  scripts?: ReadonlyMap<Id, string>;
}): LiteSegment[] {
  const { lines, duration, title } = input;
  const chapters = visibleChapters(input.chapters);
  if (chapters.length) {
    return chapters.map((c, index) => {
      const script = input.scripts?.get(c.id);
      return {
        id: c.id,
        index,
        source: 'chapter',
        title: c.title,
        start: c.start,
        end: index + 1 < chapters.length ? chapters[index + 1]!.start : Math.max(c.end, duration),
        lines: linesIn(lines, c.start, index + 1 < chapters.length ? chapters[index + 1]!.start : Infinity),
        ...(script ? { script } : {}),
      };
    });
  }
  if (lines.length) return fromSpeech(lines, duration);
  return [{ id: 'whole', index: 0, source: 'whole', title, start: 0, end: Math.max(0, duration), lines: [] }];
}

/** 没有章节：按停顿分组（停顿 ≥ LITE_SPEECH_GAP，或一组满 LITE_SPEECH_MAX 秒后在句前断开），标题取段首句的前几个字。 */
function fromSpeech(lines: readonly LiteLine[], duration: number): LiteSegment[] {
  const groups: { start: number; end: number; lines: LiteLine[] }[] = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    if (last && line.start - last.end < LITE_SPEECH_GAP && line.end - last.start <= LITE_SPEECH_MAX) {
      last.end = Math.max(last.end, line.end);
      last.lines.push(line);
    } else groups.push({ start: line.start, end: line.end, lines: [line] });
  }
  return groups.map((g, index) => ({
    id: `speech-${index + 1}`,
    index,
    source: 'speech',
    title: [...(g.lines[0]?.text ?? '')].slice(0, TITLE_CHARS).join('') || M.segmentN(index + 1),
    start: index === 0 ? 0 : g.start,
    end: index + 1 < groups.length ? groups[index + 1]!.start : Math.max(g.end, duration),
    lines: g.lines,
  }));
}

/** 播放头在哪一段：末段含右端点；都不在（负数、超长、没有段）时 null。 */
export function liteSegmentAt(segments: readonly LiteSegment[], seconds: number): LiteSegment | null {
  const last = segments[segments.length - 1];
  if (!last) return null;
  if (seconds >= last.start && seconds <= last.end) return last;
  return segments.find((s) => seconds >= s.start && seconds < s.end) ?? null;
}

/** 播放头落在哪一句：句与句之间的空隙算前一句（字幕的 tail 还显示着）；第一句之前 null。 */
export function liteLineAt(lines: readonly LiteLine[], seconds: number): LiteLine | null {
  let hit: LiteLine | null = null;
  for (const line of lines) {
    if (seconds >= line.start) hit = line;
    else break;
  }
  return hit;
}

/** 上一段：播放头前面最近的段起点（离当前段起点不到 0.05 秒时再往前一段）；前面没有时回到 0。 */
export function prevSegmentStart(segments: readonly LiteSegment[], seconds: number): number {
  let best = 0;
  for (const s of segments) if (s.start < seconds - NEAR) best = s.start;
  return best;
}

/** 下一段：播放头后面最近的段起点；后面没有时到片尾。 */
export function nextSegmentStart(segments: readonly LiteSegment[], seconds: number): number {
  for (const s of segments) if (s.start > seconds + NEAR) return s.start;
  const last = segments[segments.length - 1];
  return last ? last.end : seconds;
}

/** 片条的一片：占比（flex）、播放头与悬停点在片里的位置（0–1，不在这片上为 null）。 */
export interface LiteChip {
  id: string;
  index: number;
  title: string;
  start: number;
  end: number;
  span: number;
  flex: number;
  current: boolean;
  head: number | null;
  hover: number | null;
}

export function liteChips(segments: readonly LiteSegment[], playhead: number, duration: number, hover: number | null): LiteChip[] {
  const last = segments[segments.length - 1];
  const total = Math.max(last ? last.end : 0, duration > 0 ? duration : 0, 0.001);
  const frac = (t: number | null, a: number, b: number) =>
    t === null || t < a || t > b || b <= a ? null : Math.max(0, Math.min(1, (t - a) / (b - a)));
  const at = liteSegmentAt(segments, playhead);
  return segments.map((seg, index) => {
    const span = Math.max(0, seg.end - seg.start);
    const current = at?.id === seg.id;
    return {
      id: seg.id,
      index,
      title: seg.title,
      start: seg.start,
      end: seg.end,
      span,
      flex: span / total,
      current,
      head: current ? frac(playhead, seg.start, seg.end) : null,
      hover: frac(hover, seg.start, seg.end),
    };
  });
}

/** 拖第 `index` 片右边时的预览：这一片的终点与下一片的起点都换成 `seconds`（调用方已按 `chipEdge` 夹好），其余不动。 */
export function liteBoundaryPreview(segments: readonly LiteSegment[], index: number, seconds: number): LiteSegment[] {
  if (!segments[index] || !segments[index + 1]) return [...segments];
  return segments.map((s, i) => (i === index ? { ...s, end: seconds } : i === index + 1 ? { ...s, start: seconds } : s));
}

/** 片条的缩放：1 = 整条铺满播放条的宽度（默认），按钮每档 ×1.5、最大 8 倍；观看态，不进视频、不进偏好。 */
export const LITE_ZOOM_MAX = 8;
export const LITE_ZOOM_STEP = 1.5;
export type LiteZoomAction = 'in' | 'out' | 'fit' | 'segment' | 'playhead';
export const LITE_ZOOM_MENU: readonly LiteZoomAction[] = ['in', 'out', 'fit', 'segment', 'playhead'];

export function clampLiteZoom(zoom: number): number {
  const value = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.min(LITE_ZOOM_MAX, Math.max(1, Math.round(value * 100) / 100));
}
export const liteZoomIn = (zoom: number) => clampLiteZoom(zoom * LITE_ZOOM_STEP);
export const liteZoomOut = (zoom: number) => clampLiteZoom(zoom / LITE_ZOOM_STEP);
/** 百分比标签：1 = 100%，与时间线的缩放标签同一写法（整数百分比）。 */
export const liteZoomLabel = (zoom: number) => `${Math.round(clampLiteZoom(zoom) * 100)}%`;

/** 让一段铺满视野的缩放：整条时长 ÷ 这段时长，夹在 1–8 倍之间；没有可算的段回 1。 */
export function liteFitZoom(segment: LiteSegment | null, duration: number): number {
  const length = segment ? segment.end - segment.start : 0;
  return length > 0 && duration > 0 ? clampLiteZoom(duration / length) : 1;
}

/** 放大后让播放头留在视野里：头的横坐标出了 [滚动位置 + margin, 滚动位置 + 视宽 − margin] 就滚到让它落在视野的 1/3 处；不用滚回 null。 */
export function liteKeepInView(headX: number, scrollLeft: number, viewWidth: number, margin = 24): number | null {
  if (headX >= scrollLeft + margin && headX <= scrollLeft + viewWidth - margin) return null;
  return Math.max(0, Math.round(headX - viewWidth / 3));
}

/**
 * 这部视频按种类默认开哪种（轻量编辑器设计 §6 第 4 条，§11 第 2 条取保守口径）：
 * 在会话里打开、并且带章节的视频（智能体做的讲解片、章节化的口播）开轻量；其余一律时间线。
 */
export function defaultEditorView(kind: { chapters: number; inConversation: boolean }): EditorView {
  return kind.inConversation && kind.chapters > 0 ? 'lite' : 'timeline';
}

/** 打开时用哪种（§6）：路由显式给的 > 这部视频上次的选择 > 用户的全局默认 > 按种类。 */
export function resolveEditorView(input: {
  route: EditorView | null | undefined;
  remembered: EditorView | undefined;
  preference: EditorViewDefault;
  byKind: EditorView;
}): EditorView {
  if (input.route) return input.route;
  if (input.remembered) return input.remembered;
  if (input.preference !== 'auto') return input.preference;
  return input.byKind;
}

/** 偏好里按视频记的视图（只留最近的 200 部，免得无限增长）。 */
export const VIEW_MEMORY_MAX = 200;
export function rememberEditorView(byVideo: Record<Id, EditorView>, videoId: Id, view: EditorView): Record<Id, EditorView> {
  const next: Record<Id, EditorView> = { ...byVideo };
  delete next[videoId];
  const entries = Object.entries(next);
  const trimmed = entries.length >= VIEW_MEMORY_MAX ? Object.fromEntries(entries.slice(entries.length - VIEW_MEMORY_MAX + 1)) : next;
  return { ...trimmed, [videoId]: view };
}
