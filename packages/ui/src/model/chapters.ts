import { defineMessages, framesToSeconds, sequenceDurationFrames, type EditOperation, type Id, type Sequence } from '@baocut/protocol';
import { zhHans } from './chapters.zh-Hans.ts';
import { zhHant } from './chapters.zh-Hant.ts';
import { ja } from './chapters.ja.ts';
import { ko } from './chapters.ko.ts';
import { es } from './chapters.es.ts';
import { fr } from './chapters.fr.ts';
import { de } from './chapters.de.ts';
import { nl } from './chapters.nl.ts';
import { ptBR } from './chapters.pt-BR.ts';
import { it } from './chapters.it.ts';
import { ru } from './chapters.ru.ts';
import { pl } from './chapters.pl.ts';
import { tr } from './chapters.tr.ts';
import { vi } from './chapters.vi.ts';

/** 章节的文案（英文是键与类型的来源，译文在 `chapters.zh-Hans.ts`）。 */
const en = {
  chapterN: (n: number) => `Chapter ${n}`,
};
export type ChaptersMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 章节（视频格式规范 §3.13）：序列上 `kind: 'chapter'` 的标记，固定在序列帧上，不跟着实例移动；一章从它的起点到下一章的起点，
 * 最后一章到序列结尾（标记自己带时长时到时长为止，与导出页 `chapterPieces` 同一口径）。
 *
 * 这里是编辑器里章节的纯模型：时间线章节条的分段（设计稿 model-timeline.js `playbackSpans`）、播放头在哪一章、上一章 / 下一章
 * （`prevChapterStart` / `nextChapterStart`，0.05 秒容差）、拖起点的帧范围、文稿按章分组（model-chapters.js `chapterOfPara`
 * 取段中点），以及加、改名、挪起点、删除对应的编辑操作（`upsertChapter` / `removeChapter`，按帧提交，`exact-frame`）。
 */

/** 引擎收的章节标题长度上限（chapters.rs `MAX_TITLE_CHARS`）。 */
export const CHAPTER_TITLE_MAX = 200;

/** 上一章 / 下一章的容差（秒）：离章起点不到这么近时算已经在起点上（设计稿 §12.3）。 */
const NEAR = 0.05;

export interface ChapterSpan {
  id: Id;
  /** 按起点排的次序（从 0 起）。 */
  index: number;
  /** 标记上的原名（可能是空白）。 */
  label: string;
  /** 显示用：原名去空白，空的写「第 N 章」。 */
  title: string;
  startFrame: number;
  endFrame: number;
  /** 秒。 */
  start: number;
  end: number;
}

/** 序列上的章节，按起点排。起点在片尾或更后的也在里面，长度为 0（条上画不出来，但还在序列上）。 */
export function sequenceChapters(sequence: Sequence): ChapterSpan[] {
  const total = sequenceDurationFrames(sequence);
  const markers = sequence.markers.filter((m) => m.kind === 'chapter').sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id));
  return markers.map((marker, index) => {
    const next = markers[index + 1];
    const own = marker.durationFrames ? marker.frame + marker.durationFrames : null;
    const endFrame = Math.max(marker.frame, Math.min(total, own ?? next?.frame ?? total));
    return {
      id: marker.id,
      index,
      label: marker.label,
      title: marker.label.trim() || M.chapterN(index + 1),
      startFrame: marker.frame,
      endFrame,
      start: framesToSeconds(marker.frame, sequence.fps),
      end: framesToSeconds(endFrame, sequence.fps),
    };
  });
}

/** 有长度的章（条上画得出来的）。 */
export function visibleChapters(chapters: readonly ChapterSpan[]): ChapterSpan[] {
  return chapters.filter((c) => c.endFrame > c.startFrame);
}

/** 播放头在哪一章（`chapters` 里的下标）；不在任何一章里时 -1。最后一章含片尾那一刻。 */
export function chapterAt(chapters: readonly ChapterSpan[], seconds: number): number {
  let last = -1;
  for (let i = 0; i < chapters.length; i++) if (chapters[i]!.endFrame > chapters[i]!.startFrame) last = i;
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i]!;
    if (c.endFrame <= c.startFrame) continue;
    if (seconds >= c.start && (seconds < c.end || (i === last && seconds <= c.end))) return i;
  }
  return -1;
}

/** 上一章：播放头前面最近的章起点（离当前章起点不到 0.05 秒时再往前一章）；前面没有章时回到 0。 */
export function prevChapterStart(chapters: readonly ChapterSpan[], seconds: number): number {
  let best = 0;
  for (const c of visibleChapters(chapters)) if (c.start < seconds - NEAR) best = c.start;
  return best;
}

/** 下一章：播放头后面最近的章起点；后面没有章时到最后一章的结尾（片尾）。没有章时原地不动。 */
export function nextChapterStart(chapters: readonly ChapterSpan[], seconds: number): number {
  const shown = visibleChapters(chapters);
  for (const c of shown) if (c.start > seconds + NEAR) return c.start;
  return shown.length ? shown[shown.length - 1]!.end : seconds;
}

/** 章节条上的一段：一章，或章与章之间（第一章之前）没有章的空当；没有章时是整条播放进度。 */
export interface BandSegment {
  key: string;
  chapter: ChapterSpan | null;
  start: number;
  end: number;
}

/** 章节条按时间铺满 [0, 片长]：章节之间的空当补成没有章的段（点它按位置定位）。 */
export function bandSegments(chapters: readonly ChapterSpan[], duration: number): BandSegment[] {
  if (!(duration > 0)) return [];
  const out: BandSegment[] = [];
  let at = 0;
  for (const c of visibleChapters(chapters)) {
    if (c.start > at + 1e-6) out.push({ key: `gap-${at}`, chapter: null, start: at, end: c.start });
    out.push({ key: c.id, chapter: c, start: c.start, end: Math.min(duration, c.end) });
    at = c.end;
  }
  if (duration > at + 1e-6) out.push({ key: `gap-${at}`, chapter: null, start: at, end: duration });
  return out;
}

/**
 * 拖一章的起点能到哪些帧：晚于上一章起点、早于下一章起点（引擎只拒同一帧，不拒越过邻居——保住先后次序靠这里），
 * 也不出片尾。第一章最早到 0。
 */
export function startBounds(chapters: readonly ChapterSpan[], index: number, totalFrames: number): { min: number; max: number } {
  const prev = chapters[index - 1];
  const next = chapters[index + 1];
  const min = prev ? prev.startFrame + 1 : 0;
  const max = Math.min(next ? next.startFrame - 1 : Infinity, totalFrames - 1);
  return { min, max: Math.max(min, max) };
}

/** 加一章时预填的名字：落在第几章就叫「第 N 章」。 */
export function defaultChapterTitle(chapters: readonly ChapterSpan[], frame: number): string {
  return M.chapterN(chapters.filter((c) => c.startFrame < frame).length + 1);
}

export type AddChapterRefusal = 'exists' | 'beyond' | 'blank';

/** 某一帧加不加得了章（还没起名，只看位置）：落在片尾或更后（长度为 0）、那一帧已经有一章时不行；加得了时 null。 */
export function addChapterRefusal(sequence: Sequence, chapters: readonly ChapterSpan[], frame: number): Exclude<AddChapterRefusal, 'blank'> | null {
  const at = Math.max(0, Math.round(frame));
  if (at >= sequenceDurationFrames(sequence)) return 'beyond';
  if (chapters.some((c) => c.startFrame === at)) return 'exists';
  return null;
}

/** 在某一帧加一章。名字是空白、位置不行（`addChapterRefusal`）时不成立。 */
export function addChapterOperation(
  sequence: Sequence,
  chapters: readonly ChapterSpan[],
  frame: number,
  title: string,
): { ok: true; operation: EditOperation } | { ok: false; reason: AddChapterRefusal } {
  const at = Math.max(0, Math.round(frame));
  const name = title.trim();
  if (!name) return { ok: false, reason: 'blank' };
  const refusal = addChapterRefusal(sequence, chapters, at);
  if (refusal) return { ok: false, reason: refusal };
  return {
    ok: true,
    operation: {
      type: 'upsertChapter',
      sequenceId: sequence.id,
      at: { unit: 'frames', value: at },
      alignment: 'exact-frame',
      title: name.slice(0, CHAPTER_TITLE_MAX),
    },
  };
}

/** 改名：去掉首尾空白；空白或与原名相同时不写（null）。 */
export function renameChapterOperation(sequenceId: Id, chapter: ChapterSpan, title: string): EditOperation | null {
  const name = title.trim().slice(0, CHAPTER_TITLE_MAX);
  if (!name || name === chapter.label.trim()) return null;
  return { type: 'upsertChapter', sequenceId, chapterId: chapter.id, title: name };
}

/** 挪起点到某一帧（调用方已按 `startBounds` 夹好）；没动时不写（null）。 */
export function moveChapterOperation(sequenceId: Id, chapter: ChapterSpan, frame: number): EditOperation | null {
  const at = Math.max(0, Math.round(frame));
  if (at === chapter.startFrame) return null;
  return { type: 'upsertChapter', sequenceId, chapterId: chapter.id, at: { unit: 'frames', value: at }, alignment: 'exact-frame' };
}

export function removeChapterOperation(sequenceId: Id, chapter: ChapterSpan): EditOperation {
  return { type: 'removeChapter', sequenceId, chapterId: chapter.id };
}

/** 文稿里一段在序列上的区间（秒）；整段都剪掉了时是 null。 */
export type ParagraphSpan = { start: number; end: number } | null;

/** 一段的区间：首个还在时间线上的词的起点，到末个的终点（词投到几处时各取第一处，与段头的时间同一口径）。 */
export function paragraphSpan(words: readonly { placements: readonly { start: number; end: number }[] }[]): ParagraphSpan {
  let first: { start: number; end: number } | undefined;
  let last: { start: number; end: number } | undefined;
  for (const w of words) {
    const at = w.placements[0];
    if (!at) continue;
    first ??= at;
    last = at;
  }
  return first && last ? { start: first.start, end: Math.max(first.start, last.end) } : null;
}

/** 文稿按章分组后的一行：章节头行（后面跟着 `count` 段），或第 `index` 段。`chapter` 为 null 的头行是「第一章之前」。 */
export type ChapterRow = { kind: 'chapter'; chapter: ChapterSpan | null; count: number } | { kind: 'paragraph'; index: number };

/** 一段归哪一章：取段中点（段可能跨边界，用中点免得两边都算）；落在第一章之前时 -1。 */
function chapterOfSpan(chapters: readonly ChapterSpan[], span: { start: number; end: number }): number {
  const mid = (span.start + span.end) / 2;
  let hit = -1;
  for (let i = 0; i < chapters.length; i++) if (mid >= chapters[i]!.start) hit = i;
  return hit;
}

/**
 * 文稿按章分组（设计稿 panels.jsx 的 `.tsec` / `.chead`）：段落按文稿的次序走，所属的章变了就插一行章节头。
 * 整段剪掉的段跟着前一段（开头的跟着后一段）。`withEmpty` 时把跳过的、开头之前与结尾之后没有段落的章也列出来
 * （设计稿：空章节照样出头行）——只有一份转写时这样做，几份转写各自分组时空章会重复出现，不列。没有章时不插头行。
 */
export function chapterRows(chapters: readonly ChapterSpan[], paragraphs: readonly ParagraphSpan[], withEmpty: boolean): ChapterRow[] {
  const shown = visibleChapters(chapters);
  if (!shown.length) return paragraphs.map((_, index) => ({ kind: 'paragraph', index }));
  const own = paragraphs.map((span) => (span ? chapterOfSpan(shown, span) : null));
  // 整段剪掉的：先跟前一段，开头那几段跟后一段。
  let last: number | null = null;
  const filled = own.map((c) => (c === null ? last : (last = c)));
  const first = filled.find((c) => c !== null) ?? null;
  const of = filled.map((c) => c ?? first ?? -1);

  const rows: ChapterRow[] = [];
  const used = new Set(of);
  let current: number | null = null;
  // 走到过的最后一章：空章按它补，片段挪过、章号往回跳时不重复补。
  let reached = -1;
  let head: { kind: 'chapter'; chapter: ChapterSpan | null; count: number } | null = null;
  const empty = (to: number) => {
    if (withEmpty) for (let i = reached + 1; i < to; i++) if (!used.has(i)) rows.push({ kind: 'chapter', chapter: shown[i]!, count: 0 });
    reached = Math.max(reached, to);
  };
  of.forEach((c, index) => {
    if (c !== current) {
      if (c > reached) empty(c);
      // 开头那几段在第一章之前：不插头行；之后又回到第一章之前（片段被挪过）才插「第一章之前」。
      if (c >= 0 || current !== null) {
        head = { kind: 'chapter', chapter: c >= 0 ? shown[c]! : null, count: 0 };
        rows.push(head);
      }
      current = c;
    }
    if (head) head.count += 1;
    rows.push({ kind: 'paragraph', index });
  });
  empty(shown.length);
  return rows;
}

// ---- 文稿里按章、按段的操作（设计稿 model-chapters.js `movePlan`，panels.jsx 段落行的 ↑ ↓ 与章节头「这一章…」） ----

/** 把一段挪到相邻章的做法：挪的是哪一章的起点、挪到哪一帧，连带几段一起走。 */
export interface ParagraphMove {
  /** 这一段现在所在的章。 */
  from: ChapterSpan;
  /** 挪到的章。 */
  to: ChapterSpan;
  frame: number;
  operation: EditOperation;
  /** 跟着换章的段数（含这一段）。 */
  moved: number;
}

/**
 * 把第 `index` 段挪到上一章（-1）或下一章（+1）。章节是连续的时间区间，只挪被跨过的那一条边界，所以同侧的邻居一起走：
 * 往前挪时这一章的起点挪到同章下一段的开头，往后挪时下一章的起点挪到这一段的开头（向下取整到帧）。
 * 本章至少留一段（把自己的章掏空只会得到一个零长的章，设计稿同样不成立）；第一章之前的段、整段剪掉的段、
 * 挪过去会越过邻章起点或出片尾的，都不成立（null）。段按中点归章，与 `chapterRows` 同一口径。
 */
export function moveParagraphPlan(
  sequence: Sequence,
  chapters: readonly ChapterSpan[],
  spans: readonly ParagraphSpan[],
  index: number,
  dir: -1 | 1,
): ParagraphMove | null {
  const shown = visibleChapters(chapters);
  const own = spans[index];
  if (!own || shown.length < 2) return null;
  const c = chapterOfSpan(shown, own);
  const from = shown[c];
  const to = shown[c + dir];
  if (!from || !to) return null;
  const mine = spans
    .map((span, n) => ({ span, n }))
    .filter((p): p is { span: { start: number; end: number }; n: number } => p.span !== null && chapterOfSpan(shown, p.span) === c)
    .sort((a, b) => a.span.start - b.span.start || a.n - b.n);
  const at = mine.findIndex((p) => p.n === index);
  if (at < 0) return null;
  const perSecond = sequence.fps.num / sequence.fps.den;
  const mid = (span: { start: number; end: number }) => (span.start + span.end) / 2;
  const total = sequenceDurationFrames(sequence);
  if (dir < 0) {
    const rest = mine[at + 1];
    if (!rest) return null;
    const frame = Math.floor(rest.span.start * perSecond + 1e-6);
    const bounds = startBounds(chapters, from.index, total);
    if (frame < bounds.min || frame > bounds.max || frame / perSecond <= mid(own) || frame / perSecond > mid(rest.span)) return null;
    const operation = moveChapterOperation(sequence.id, from, frame);
    return operation ? { from, to, frame, operation, moved: at + 1 } : null;
  }
  const prev = mine[at - 1];
  if (!prev) return null;
  const frame = Math.floor(own.start * perSecond + 1e-6);
  const bounds = startBounds(chapters, to.index, total);
  if (frame < bounds.min || frame > bounds.max || frame / perSecond > mid(own) || frame / perSecond <= mid(prev.span)) return null;
  const operation = moveChapterOperation(sequence.id, to, frame);
  return operation ? { from, to, frame, operation, moved: mine.length - at } : null;
}

/** 剪掉一章不成立的原因：这一章没有长度、它就是整个视频、没有要剪的轨道。 */
export type ChapterCutRefusal = 'empty' | 'whole' | 'no-tracks';

/**
 * 剪掉一章（一笔事务）：`removeRange` 删掉这一章的区间（声明的轨道由调用方给，与文稿里剪一段同一套），删掉这一章的标记，
 * 后面各章的起点按升序前移这一章的长度——引擎的 `removeRange` 只挪实例、不挪标记，不跟着挪的话后面的章会错位。
 * 按升序逐章挪，每一步落到的帧都空着（前一章已经挪走或删掉），不会撞上同一帧。
 */
export function cutChapterOperations(
  sequence: Sequence,
  chapters: readonly ChapterSpan[],
  chapter: ChapterSpan,
  trackIds: readonly Id[],
): { ok: true; operations: EditOperation[]; frames: number } | { ok: false; reason: ChapterCutRefusal } {
  const length = chapter.endFrame - chapter.startFrame;
  if (length <= 0) return { ok: false, reason: 'empty' };
  if (chapter.startFrame <= 0 && chapter.endFrame >= sequenceDurationFrames(sequence)) return { ok: false, reason: 'whole' };
  if (!trackIds.length) return { ok: false, reason: 'no-tracks' };
  const operations: EditOperation[] = [
    {
      type: 'removeRange',
      sequenceId: sequence.id,
      from: { unit: 'frames', value: chapter.startFrame },
      to: { unit: 'frames', value: chapter.endFrame },
      trackIds: [...trackIds],
      alignment: 'exact-frame',
    },
    removeChapterOperation(sequence.id, chapter),
  ];
  for (const later of [...chapters].filter((c) => c.startFrame > chapter.startFrame).sort((a, b) => a.startFrame - b.startFrame)) {
    operations.push({
      type: 'upsertChapter',
      sequenceId: sequence.id,
      chapterId: later.id,
      at: { unit: 'frames', value: Math.max(chapter.startFrame, later.startFrame - length) },
      alignment: 'exact-frame',
    });
  }
  return { ok: true, operations, frames: length };
}
