import type { TextEntry, TextPlan } from './export-plan.ts';
import type { TextChapter } from './text-export.ts';

/**
 * 文稿不跳过剪掉的部分（`skipCut: false`，命令与协议规范 §4.4）：不经时间线投影，直接从文档正文取条目——转写的词、
 * 字幕的句子，时间是文档自己的时钟（秒）。取法与引擎 `text_plan.rs` 的 `speech_entries` / `caption_entries` 相同：
 * 隐藏的词与空白的条目不要（隐藏是文稿里删掉的字，不是时间线上剪掉的），零时长的词占后面的空隙，词时间不可信的词标出来。
 */

interface SpeechWord {
  id?: string;
  text?: string;
  start?: number;
  end?: number;
  hidden?: boolean;
  speaker?: string;
  timingQuality?: string;
}

interface SpeechSentence {
  id?: string;
  first?: string;
  last?: string;
  wordIds?: string[];
  paragraphStart?: boolean;
}

interface CaptionCue {
  id?: string;
  text?: string;
  start?: number;
  end?: number;
  speaker?: string;
  paragraphStart?: boolean;
}

interface SourceBody {
  timescale?: number;
  words?: SpeechWord[];
  sentences?: SpeechSentence[] | null;
  cues?: CaptionCue[];
}

/** 零时长的词在后面的空隙里占的一段：到下一个词的起点为止、至多 0.08 秒；下一个词就从这里开始时没有（略过）。 */
const ZERO_DURATION_SLOT = 0.08;

function speechEntries(body: SourceBody, seconds: (ticks: number | undefined) => number): TextEntry[] {
  const words = Array.isArray(body.words) ? body.words : [];
  const index = new Map(words.map((w, i) => [w.id, i]));
  const sentenceOf: Array<{ id: string; paragraphStart: boolean } | undefined> = [];
  for (const sentence of body.sentences ?? []) {
    if (typeof sentence.id !== 'string') continue;
    let members: number[] = [];
    if (Array.isArray(sentence.wordIds)) members = sentence.wordIds.map((id) => index.get(id)).filter((i): i is number => i !== undefined);
    else {
      const a = index.get(sentence.first);
      const b = index.get(sentence.last);
      if (a !== undefined && b !== undefined && a <= b) members = Array.from({ length: b - a + 1 }, (_, k) => a + k);
    }
    members.forEach((i, n) => (sentenceOf[i] = { id: sentence.id!, paragraphStart: sentence.paragraphStart === true && n === 0 }));
  }
  const entries: TextEntry[] = [];
  words.forEach((word, i) => {
    const text = word.text ?? '';
    if (word.hidden || !text.trim()) return;
    const start = seconds(word.start);
    let end = seconds(word.end);
    if (end <= start) {
      const next = words.slice(i + 1).find((w) => typeof w.start === 'number');
      const nextStart = next ? seconds(next.start) : null;
      if (nextStart !== null && nextStart <= start) return;
      end = nextStart !== null && nextStart < start + ZERO_DURATION_SLOT ? nextStart : start + ZERO_DURATION_SLOT;
    }
    const id = word.id ?? '';
    const sentence = sentenceOf[i];
    entries.push({
      key: id,
      id,
      start,
      end,
      text,
      ...(word.speaker !== undefined ? { speaker: word.speaker } : {}),
      ...(sentence ? { sentenceId: sentence.id, paragraphStart: sentence.paragraphStart } : {}),
      wordTiming: word.timingQuality !== 'estimated' && word.timingQuality !== 'missing' && !/\s/.test(text.trim()),
    });
  });
  return entries;
}

function captionEntries(body: SourceBody, seconds: (ticks: number | undefined) => number): TextEntry[] {
  const entries: TextEntry[] = [];
  for (const cue of Array.isArray(body.cues) ? body.cues : []) {
    const text = cue.text ?? '';
    const start = seconds(cue.start);
    const end = seconds(cue.end);
    if (!text.trim() || end <= start) continue;
    const id = cue.id ?? '';
    entries.push({
      key: id,
      id,
      start,
      end,
      text,
      ...(cue.speaker !== undefined ? { speaker: cue.speaker } : {}),
      ...(cue.paragraphStart ? { paragraphStart: true } : {}),
      wordTiming: false,
    });
  }
  return entries;
}

/**
 * 一份文档不经投影的计划。`projected` 是它在这段范围里的投影：`whole` 时取整份文档；不然（给了范围）取投影到的第一条与
 * 最后一条之间（按文档里的顺序）的原文，其间剪掉的部分都在。计划的范围是 `[0, 最后一条的结束)`。
 */
export function sourcePlan(body: unknown, projected: TextPlan, whole: boolean): TextPlan {
  const source = (body ?? {}) as SourceBody;
  const timescale = typeof source.timescale === 'number' && source.timescale > 0 ? source.timescale : 1;
  const seconds = (ticks: number | undefined) => (typeof ticks === 'number' ? ticks / timescale : 0);
  let entries = projected.unit === 'speech' ? speechEntries(source, seconds) : captionEntries(source, seconds);
  if (!whole) {
    const order = new Map(entries.map((e, i) => [e.id, i]));
    const at = projected.entries.map((e) => order.get(e.id)).filter((i): i is number => i !== undefined);
    entries = at.length > 0 ? entries.slice(Math.min(...at), Math.max(...at) + 1) : [];
  }
  const end = Math.max(0, ...entries.map((e) => e.end));
  return {
    ...projected,
    range: { startSeconds: 0, endSeconds: end, durationSeconds: end },
    entries,
    sourceCount: entries.length,
    omittedCount: 0,
  };
}

/**
 * 章节换到原文的时钟：章节标记在序列时间上（相对范围起点，`chapters`），取它之后投影出来的第一条（结束晚于章节开始的那一条）
 * 在原文里的开始。之后没有文字的章节不要。
 */
export function sourceChapters(chapters: readonly TextChapter[], projected: TextPlan, source: TextPlan): TextChapter[] {
  const startOf = new Map<string, number>();
  for (const entry of source.entries) if (!startOf.has(entry.id)) startOf.set(entry.id, entry.start);
  const timeline = [...projected.entries].sort((a, b) => a.start - b.start);
  const out: TextChapter[] = [];
  for (const chapter of chapters) {
    const entry = timeline.find((e) => e.end > chapter.start);
    const start = entry ? startOf.get(entry.id) : undefined;
    if (start !== undefined) out.push({ title: chapter.title, start });
  }
  return out.sort((a, b) => a.start - b.start);
}
