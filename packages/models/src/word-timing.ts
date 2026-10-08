import type { Segment } from './worker-contract.ts';

/**
 * 词时间的插值与单调修正，与 Rust 端（`crates/model-runtime/src/speech/word_timing.rs`、`text_prep.rs`、
 * `asr_result.rs` 的 `fix_word_times`）同一规则（架构设计 §6.6 第 5、6 步）。在线 Provider 只给段级时间时用它把
 * 词按字符长度插进段里并标 `estimated`。
 *
 * 分词：空格分词的语言按空白切，中间的汉字逐字成词；日、韩、泰等无空格语言用 `Intl.Segmenter` 分词（Rust 端是 ICU4X，
 * 两者的词典不完全一致，词的切分可能略有出入，时间规则相同）。每个词保留原样的 `surface`（含贴在后面的标点）与只留
 * 字母、数字、附加符号与撇号的 `cleaned`；权重是 `cleaned` 的字符数（至少 1）。
 */

export interface WordPair {
  surface: string;
  cleaned: string;
}

export interface EstimatedWord {
  text: string;
  start: number;
  end: number;
}

const DICTIONARY_LANGUAGES = [
  'ja',
  'ko',
  'th',
  'lo',
  'km',
  'my',
  'bo',
  'japanese',
  'korean',
  'thai',
  'lao',
  'khmer',
  'burmese',
  'myanmar',
  'tibetan',
];

/** 留下的字符：撇号与 Unicode 的字母（L*）、数字（Nd、Nl、No）、附加符号（M*）。 */
const KEPT = /[\p{L}\p{N}\p{M}']/u;
const KEPT_GLOBAL = /[\p{L}\p{N}\p{M}']/gu;

function isKept(char: string): boolean {
  return KEPT.test(char);
}

export function cleanToken(token: string): string {
  return (token.match(KEPT_GLOBAL) ?? []).join('');
}

/** 假名、谚文、泰文、老挝文、高棉文、缅文、藏文。 */
function needsDictionarySegmentation(char: string): boolean {
  const c = char.codePointAt(0)!;
  return (
    (c >= 0x3040 && c <= 0x30ff) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0x1100 && c <= 0x11ff) ||
    (c >= 0x0e00 && c <= 0x0eff) ||
    (c >= 0x1780 && c <= 0x17ff) ||
    (c >= 0x1000 && c <= 0x109f) ||
    (c >= 0x0f00 && c <= 0x0fff)
  );
}

export function isHanIdeograph(char: string): boolean {
  const c = char.codePointAt(0)!;
  return (
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x20000 && c <= 0x2a6df) ||
    (c >= 0x2a700 && c <= 0x2b73f) ||
    (c >= 0x2b740 && c <= 0x2b81f) ||
    (c >= 0x2b820 && c <= 0x2ceaf) ||
    (c >= 0xf900 && c <= 0xfaff)
  );
}

/** 文本 → 词。`language` 是语言码或语言名；没有时按字符本身判断要不要走词典分词。 */
export function splitIntoWordPairs(text: string, language?: string | null): WordPair[] {
  let native: boolean;
  if (language) {
    const lower = language.toLowerCase();
    native = DICTIONARY_LANGUAGES.some((candidate) => lower === candidate || lower.includes(candidate));
  } else {
    native = [...text].some(needsDictionarySegmentation);
  }
  return native ? nativeTokenizePairs(text) : tokenizeSpaceLanguagePairs(text);
}

function nativeTokenizePairs(text: string): WordPair[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  const ranges: Array<{ start: number; end: number }> = [];
  for (const part of segmenter.segment(text)) {
    if (cleanToken(part.segment) !== '') ranges.push({ start: part.index, end: part.index + part.segment.length });
  }
  const pairs: WordPair[] = [];
  ranges.forEach((range, index) => {
    const cleaned = cleanToken(text.slice(range.start, range.end));
    if (!cleaned) return;
    let surface = text.slice(range.start, range.end);
    const nextStart = ranges[index + 1]?.start ?? text.length;
    for (const char of text.slice(range.end, nextStart)) {
      if (/\s/u.test(char) || isKept(char)) break;
      surface += char;
    }
    pairs.push({ surface, cleaned });
  });
  return pairs;
}

export function tokenizeSpaceLanguagePairs(text: string): WordPair[] {
  const pairs: WordPair[] = [];
  for (const segment of text.split(/\s+/u).filter(Boolean)) {
    const before = pairs.length;
    appendSpaceSegment(segment, pairs);
    // 整段都是标点：贴到前一个词上。
    if (pairs.length === before && pairs.length > 0) pairs[pairs.length - 1]!.surface += segment;
  }
  return pairs;
}

function appendSpaceSegment(segment: string, pairs: WordPair[]): void {
  const chars = [...segment];
  if (!chars.some(isHanIdeograph)) {
    const cleaned = cleanToken(segment);
    if (cleaned) pairs.push({ surface: segment, cleaned });
    return;
  }
  const pairStart = pairs.length;
  const buffer = { value: '' };
  for (const char of chars) {
    if (isHanIdeograph(char)) {
      flushNonHan(buffer, pairs, pairStart, true);
      const surface = buffer.value ? buffer.value + char : char;
      buffer.value = '';
      pairs.push({ surface, cleaned: char });
    } else {
      buffer.value += char;
    }
  }
  flushNonHan(buffer, pairs, pairStart, false);
}

function flushNonHan(buffer: { value: string }, pairs: WordPair[], pairStart: number, beforeHan: boolean): void {
  if (!buffer.value) return;
  const cleaned = cleanToken(buffer.value);
  if (!cleaned) {
    if (pairs.length > pairStart) {
      pairs[pairs.length - 1]!.surface += buffer.value;
      buffer.value = '';
    } else if (!beforeHan) {
      buffer.value = '';
    }
    // 在汉字之前、且这一段还没有词：留着，作为下一个汉字的前缀。
    return;
  }
  pairs.push({ surface: buffer.value, cleaned });
  buffer.value = '';
}

/**
 * 把一段文本的词按字符长度插进 `[start, end]`（秒）。最后一个词结束于段尾；分不出词时整段文本算一个词；空文本没有词。
 */
export function estimateWords(text: string, language: string | null | undefined, start: number, end: number): EstimatedWord[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const segmentEnd = Math.max(end, start);
  const pairs = splitIntoWordPairs(trimmed, language);
  if (pairs.length === 0) return [{ text: trimmed, start, end: segmentEnd }];
  const weights = pairs.map((pair) => Math.max(1, [...pair.cleaned].length));
  const total = weights.reduce((a, b) => a + b, 0);
  const words: EstimatedWord[] = [];
  let consumed = 0;
  let cursor = start;
  pairs.forEach((pair, index) => {
    consumed += weights[index]!;
    const wordEnd = index + 1 === pairs.length ? segmentEnd : Math.min(start + ((segmentEnd - start) * consumed) / total, segmentEnd);
    words.push({ text: pair.surface, start: cursor, end: wordEnd });
    cursor = wordEnd;
  });
  return words;
}

/** 秒 → 整数 tick（四舍五入；负数与非有限值按 0）。 */
export function secondsToTicks(seconds: number, timescale: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds * timescale);
}

/**
 * 词时间的单调修正：词在段内、起止不倒挂、后一个词不早于前一个词结束。被修正的词保留原来的 `timingQuality`；
 * `missing` 的词固定在段起点。返回是否改动过有时间的词（改动过时调用方加 `timing-adjusted` 警告）。
 */
export function fixWordTimes(segment: Segment): boolean {
  const { start, end } = segment;
  let adjusted = false;
  let previousEnd = start;
  for (const word of segment.words) {
    if (word.timingQuality === 'missing') {
      word.start = start;
      word.end = start;
      continue;
    }
    const fixedStart = clamp(word.start, previousEnd, end);
    const fixedEnd = clamp(word.end, fixedStart, end);
    if (fixedStart !== word.start || fixedEnd !== word.end) {
      adjusted = true;
      word.start = fixedStart;
      word.end = fixedEnd;
    }
    previousEnd = word.end;
  }
  return adjusted;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
