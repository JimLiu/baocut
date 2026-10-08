import {
  EXPORT_MAX_CUE_SECONDS,
  itemRangeSeconds,
  mediaTimeToSeconds,
  type EditOperation,
  type Id,
  type Sequence,
  type SequenceItem,
} from '@baocut/protocol';
import { CAPTION_SCHEMA } from './cue-edit.ts';
import { trackFree } from './editor-ops.ts';

/**
 * 转写（`baocut.speech/1`）→ 字幕（`baocut.caption/1`）：在素材时钟上把词表贪心切成一条条字幕，经作用实例投到序列上。
 *
 * 来源（modified）：
 * - 切条的贪心阶梯移植自旧版 `baocut-app/core/crates/bcut-flow-core/src/cue.rs`（`derive_cues` 与 `auto_break`，
 *   规范 §18.5）以及同目录 `atomize.rs` 的 `sentence_end` / `clause_end_char` / 缩写表。只移植贪心派生；
 *   `layout.rs` 的 DP 排版与手工的 break / nobreak 钉不移植（新格式里没有这两张表）。
 * - 显示宽度、拼词与句子成员关系改成与 `packages/runtime-core/src/exports/text-export.ts`
 *   （`displayWidth` / `joinWords` / `segmentsOf`）一致，免得「生成的字幕」和「导出的字幕」切法不一样：
 *   行宽是拼好的文字的显示宽度（全角字算 2），不再是 cue.rs 的逐词累加；
 *   远端分句的条件（段首、存了句子时句子变了、没存句子时停顿超过 1 秒或句末标点）在这里一律强制断开，
 *   所以字幕条的边界是导出句子边界的超集，一条字幕不会跨两句。远端还在作用实例变了时分句：字幕在素材时钟上切，
 *   剪切点落在一条字幕中间时，两边各显示这一条被裁开的部分。
 *   拼词有一处不同：韩文词之间照常加空格（text-export.ts 把谚文算成全角字，词会粘在一起）。
 * - 词从素材时钟投到序列时钟的规则（`projectSpeech`，文稿定位与「在不在时间线上」用）照抄
 *   `crates/render-graph/src/text_plan.rs` 的 `asset-items` 投影：
 *   引用这个素材的实例按起点排，各自只占别人没占的区间，按 `itemStart + (src − sourceIn) / rate` 映射并裁在区间里；
 *   定格与速度不为正的实例跳过。
 * - 没有词时间的段（`timingQuality: 'missing'`，整段文字写成一个词，见 packages/jobs 的 speech-document.ts；
 *   或旧文档里文字中间有空白的词）先按空白与句末、从句标点拆开，过宽的再按宽度切，时间按显示宽度在段内线性插值，
 *   免得几十秒的一整段成了一条字幕。
 *
 * 架构偏差：
 * - 这块本该在 `crates/speech-doc`（Rust，与导出共用一份），眼下先放在 UI 的模型层，算好后用一笔事务写进去。
 *
 * 写出的字幕文档在素材时钟上（`clock: 'source-asset'`），字幕实例的 `scopeItemIds` 是时间线上取用这个素材的实例：
 * 之后移动、裁切、拆分或删除媒体片段，字幕跟着走（引擎拆分时把右半边加进作用实例，删除时拿掉）。
 */

type Json = Record<string, unknown>;

/** cue.rs 的规范缺省参数（§18.5），宽度按显示宽度数。 */
export const CUE_PARAMS = {
  maxChars: 42,
  pauseSec: 0.6,
  /** 从句标点（逗号类）断行的最短行宽。 */
  minClauseChars: 12,
  minPauseChars: 20,
  /** 破折号断行的最短行宽，比逗号档低。 */
  minDashChars: 6,
  overflowSlack: 8,
} as const;

export type CueParams = { [K in keyof typeof CUE_PARAMS]: number };

/** 远端导出的分句停顿（秒）：没存句子的转写，词间停顿超过它就分句。 */
const PAUSE_SECONDS = 1;

// ---- 字符规则（与 text-export.ts 相同，谚文的空格除外） ----

const SENTENCE_END = /[.!?\u{3002}\u{ff01}\u{ff1f}\u{2026}]["'\u{201d}\u{2019}\u{ff09})\]]*$/u;
const NO_SPACE_BEFORE =
  /^[,.!?;:%)\]}'\u{2019}\u{201d}\u{2026}\u{ff0c}\u{3002}\u{ff01}\u{ff1f}\u{ff1b}\u{ff1a}\u{3001}\u{ff09}\u{300d}\u{300f}\u{3011}\u{300b}]/u;
const WIDE =
  /[\u{1100}-\u{115f}\u{2e80}-\u{303e}\u{3041}-\u{33ff}\u{3400}-\u{4dbf}\u{4e00}-\u{9fff}\u{a000}-\u{a4cf}\u{ac00}-\u{d7a3}\u{f900}-\u{faff}\u{fe30}-\u{fe4f}\u{ff00}-\u{ff60}\u{ffe0}-\u{ffe6}\u{20000}-\u{3fffd}]/u;
/** 谚文：显示上是全角，但韩文词之间用空格隔开。 */
const HANGUL = /[\u{1100}-\u{11ff}\u{3130}-\u{318f}\u{a960}-\u{a97f}\u{ac00}-\u{d7a3}\u{d7b0}-\u{d7ff}]/u;

/** 显示宽度：全角字算 2。 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += WIDE.test(char) ? 2 : 1;
  return width;
}

/** 两个词之间要不要空格：西文与韩文的词之间要；挨着汉字、假名、全角符号的不要。 */
const spaced = (char: string) => !WIDE.test(char) || HANGUL.test(char);

/** 词拼成文字：词自带前导空格的（一些识别器的习惯）原样接；否则西文、韩文词之间加空格，汉字、假名与标点前不加。 */
export function joinWords(tokens: readonly string[], leadingSpaces: boolean): string {
  if (leadingSpaces) return tokens.join('').replace(/\s+/g, ' ').trim();
  let out = '';
  for (const raw of tokens) {
    const token = raw.trim();
    if (!token) continue;
    if (!out) {
      out = token;
      continue;
    }
    const prev = [...out].at(-1)!;
    const next = [...token][0]!;
    const space = spaced(prev) && spaced(next) && !NO_SPACE_BEFORE.test(token);
    out += space ? ` ${token}` : token;
  }
  return out;
}

// ---- 标点（cue.rs / atomize.rs） ----

// i18n-ignore-start: 断句用的标点（照 cue.rs / atomize.rs），是语言处理不是显示文案
const CLOSERS = new Set(['”', '"', '’', "'", '」', '』', '）', ')', ']', '》']);
const TERMINAL = new Set(['。', '．', '.', '？', '?', '！', '!', '…']);
const CLAUSE_END = new Set([',', ';', ':', '—', '–', '，', '；', '：', '、']);
// i18n-ignore-end
/** 小写词干缩写表：`Dr.` 的句点不是句末。 */
const SENTENCE_ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'sr', 'jr', 'rev', 'hon', 'fr', 'gen', 'gov', 'sen',
  'rep', 'col', 'lt', 'sgt', 'capt', 'vs', 'etc', 'inc', 'ltd', 'corp', 'dept', 'vol', 'fig',
]);

/** 句末（atomize.rs `sentence_end`）：至多跳过一个右引号或括号后是终止标点；`.` 的词干里另有 `.` 或词干是缩写时不算。 */
export function sentenceEnd(token: string): boolean {
  const chars = [...token];
  let index = chars.length;
  if (index > 0 && CLOSERS.has(chars[index - 1]!)) index--;
  if (index === 0) return false;
  const last = chars[index - 1]!;
  if (!TERMINAL.has(last)) return false;
  if (last === '.') {
    const stem = chars.slice(0, index - 1).join('');
    if (stem.includes('.')) return false; // 2.14 / a.com / U.S.
    const bare = stem.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
    if (SENTENCE_ABBREV.has(bare)) return false;
  }
  return true;
}

/** 从句标点（atomize.rs `clause_end_char`）：至多跳过一个右引号或括号后的尾标点；不是时返回 null。 */
export function clauseEndChar(token: string): string | null {
  const chars = [...token];
  let index = chars.length;
  if (index > 0 && CLOSERS.has(chars[index - 1]!)) index--;
  if (index === 0) return null;
  const last = chars[index - 1]!;
  return CLAUSE_END.has(last) ? last : null;
}

// ---- 读转写 ----

/** 转写里的一个词（素材时钟，秒）。 */
export interface SpeechWord {
  id: string;
  start: number;
  end: number;
  /** 原样保留（不 trim）：有的识别器用前导空格表示词间空白。 */
  text: string;
  /** 说话人 ID。 */
  speaker?: string;
  sentenceId?: string;
  /** 这一句标了段首、且这是句子的第一个成员。 */
  paragraphStart: boolean;
}

export interface SpeechWords {
  words: SpeechWord[];
  /** 说话人 ID → 显示名。 */
  speakers: Map<string, string>;
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * 读 `baocut.speech/1` 的词（照 text_plan.rs 的 `speech_entries`）：跳过隐藏的、空白的与时长不为正的词；
 * 句子认 `wordIds` 与 `first` / `last` 两种写法；`sentences` 为 null 时没有句子。不是转写正文时返回 null。
 * 没有词时间的整段按 `splitUntimed` 拆开。
 */
export function readSpeechWords(body: unknown, params: CueParams = CUE_PARAMS): SpeechWords | null {
  if (!isObject(body) || body.schema !== 'baocut.speech/1' || !Array.isArray(body.words)) return null;
  const scale = finite(body.timescale) || 1_000_000;
  const raw = body.words.filter(isObject);
  const index = new Map<string, number>();
  raw.forEach((word, i) => {
    const id = text(word.id);
    if (id !== undefined) index.set(id, i);
  });
  const sentenceOf: Array<{ id: string; paragraph: boolean } | undefined> = [];
  for (const sentence of Array.isArray(body.sentences) ? body.sentences.filter(isObject) : []) {
    const id = text(sentence.id);
    if (id === undefined) continue;
    const paragraph = sentence.paragraphStart === true;
    let members: number[] = [];
    if (Array.isArray(sentence.wordIds)) {
      members = sentence.wordIds.flatMap((wordId) => {
        const at = typeof wordId === 'string' ? index.get(wordId) : undefined;
        return at === undefined ? [] : [at];
      });
    } else {
      const first = index.get(text(sentence.first) ?? '');
      const last = index.get(text(sentence.last) ?? '');
      if (first !== undefined && last !== undefined && first <= last) members = Array.from({ length: last - first + 1 }, (_, n) => first + n);
    }
    members.forEach((at, n) => (sentenceOf[at] = { id, paragraph: paragraph && n === 0 }));
  }
  const words: SpeechWord[] = [];
  const leading = raw.some((word) => /^\s/.test(text(word.text) ?? ''));
  // 零时长的词前面还没有词时，文字先记着，接到下一个词的前面。
  let carried = '';
  raw.forEach((word, i) => {
    if (word.hidden === true) return;
    const value = text(word.text) ?? '';
    if (!value.trim()) return;
    const start = finite(word.start);
    let end = finite(word.end);
    if (start === null || end === null) return;
    if (end <= start) {
      // 零时长的词（转写给的词时间塌成一点）不丢：后面有空隙就占一小段，没有就把文字并进相邻的词。
      end = slotAfter(raw, i, start, scale);
      if (end === null) {
        const previous = words.at(-1);
        if (previous) previous.text = joinWords([previous.text, value], leading);
        else carried = carried ? joinWords([carried, value], leading) : value;
        return;
      }
    }
    const speaker = text(word.speaker);
    const sentence = sentenceOf[i];
    const id = text(word.id) ?? '';
    const untimed = word.timingQuality === 'missing' || /\S\s+\S/.test(value.trim());
    const pieces = untimed ? splitUntimed(value, start / scale, end / scale, params.maxChars) : [{ text: value, start: start / scale, end: end / scale }];
    pieces.forEach((piece, n) =>
      words.push({
        id: n === 0 ? id : `${id}~${n + 1}`,
        start: piece.start,
        end: piece.end,
        text: n === 0 && carried ? joinWords([carried, piece.text], leading) : piece.text,
        ...(speaker !== undefined ? { speaker } : {}),
        ...(sentence ? { sentenceId: sentence.id } : {}),
        paragraphStart: n === 0 && (sentence?.paragraph ?? false),
      }),
    );
    carried = '';
  });
  if (carried && words.length) words[words.length - 1]!.text = joinWords([words[words.length - 1]!.text, carried], leading);
  const speakers = new Map<string, string>();
  for (const speaker of Array.isArray(body.speakers) ? body.speakers.filter(isObject) : []) {
    const id = text(speaker.id);
    if (id !== undefined) speakers.set(id, text(speaker.name)?.trim() || id);
  }
  return { words, speakers };
}

/** 零时长的词占的名义时长（秒）：对齐器的一个时间格。 */
const NOMINAL_WORD_SECONDS = 0.08;

/**
 * 零时长的词在后面的空隙里占一小段（刻度）：到下一个有时间的词（隐藏的也算，它的时间还在）的起点为止、至多一个名义时长；
 * 后面没有词时直接补一个名义时长；下一个词就从这里开始（没有空隙）时返回 null。
 */
function slotAfter(raw: readonly Json[], index: number, start: number, scale: number): number | null {
  for (let n = index + 1; n < raw.length; n++) {
    const next = finite(raw[n]!.start);
    if (next === null) continue;
    return next > start ? Math.min(next, start + NOMINAL_WORD_SECONDS * scale) : null;
  }
  return start + NOMINAL_WORD_SECONDS * scale;
}

const BREAK_AFTER = new Set([...TERMINAL, ...CLAUSE_END]);

/**
 * 没有词时间的一段拆成几块：在空白处与句末、从句标点（连同跟着的右引号、括号）之后断开，宽过 `maxChars` 的再按宽度切；
 * 时间按各块的显示宽度在 [start, end] 里线性分。拆不开时原样一块。
 */
export function splitUntimed(value: string, start: number, end: number, maxChars: number): Array<{ text: string; start: number; end: number }> {
  const chunks: string[] = [];
  let current = '';
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };
  const chars = [...value];
  chars.forEach((char, i) => {
    if (/\s/.test(char)) return push();
    current += char;
    // 标点后面紧跟着字的（中日文不用空格）：挨着全角字时才断，`2.14`、`3:30`、`1,000` 不断。
    const next = chars[i + 1];
    if (next === undefined || /\s/.test(next) || CLOSERS.has(next)) return;
    if (!BREAK_AFTER.has(char) && !CLOSERS.has(char)) return;
    if ((WIDE.test(char) || WIDE.test(next)) && sentenceOrClause(current)) push();
  });
  push();
  const pieces = chunks.flatMap((chunk) => chopWide(chunk, maxChars));
  if (pieces.length <= 1) return [{ text: value, start, end }];
  const widths = pieces.map((piece) => Math.max(1, displayWidth(piece)));
  const total = widths.reduce((sum, width) => sum + width, 0);
  let at = 0;
  return pieces.map((piece, n) => {
    const from = start + ((end - start) * at) / total;
    at += widths[n]!;
    return { text: piece, start: from, end: n === pieces.length - 1 ? end : start + ((end - start) * at) / total };
  });
}

/** 这一块收在句末或从句标点上（`Dr.`、`2.14` 这类不算）。 */
function sentenceOrClause(chunk: string): boolean {
  return sentenceEnd(chunk) || clauseEndChar(chunk) !== null;
}

/** 宽过 `maxChars` 的一块按显示宽度切成差不多一样宽的几段。 */
function chopWide(chunk: string, maxChars: number): string[] {
  const width = displayWidth(chunk);
  if (width <= maxChars) return [chunk];
  const parts = Math.ceil(width / maxChars);
  const target = width / parts;
  const out: string[] = [];
  let current = '';
  let used = 0;
  for (const char of chunk) {
    const w = displayWidth(char);
    if (current && used + w > target * (out.length + 1) + 1e-9 && out.length < parts - 1) {
      out.push(current);
      current = '';
    }
    current += char;
    used += w;
  }
  if (current) out.push(current);
  return out;
}

// ---- 投到序列上 ----

/** 投到序列上的一个词（秒）。同一个词经两个实例出现两次时 `key` 不同。 */
export interface PlacedWord extends SpeechWord {
  key: string;
  scopeItemId: Id;
}

/** 实例取用的素材：视频与音频的素材，合成的预渲染替身（没有时是代码包）。与 text_plan.rs 的 `source_asset` 相同。 */
function sourceAsset(item: SequenceItem): Id | undefined {
  if (item.type === 'video' || item.type === 'audio') return item.assetRef.id;
  if (item.type === 'composition') return (item.prerender ?? (item.source.kind === 'bundle' ? item.source.assetRef : undefined))?.id;
  return undefined;
}

function linearMap(item: SequenceItem): { sourceIn: number; rate: number } | null {
  if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'composition') return null;
  if (item.timeMap.kind !== 'linear') return null;
  const rate = item.timeMap.rate.num / item.timeMap.rate.den;
  if (!(rate > 0)) return null;
  return { sourceIn: mediaTimeToSeconds(item.timeMap.sourceIn), rate };
}

/** `interval` 扣掉 `taken` 里的区间之后剩下的部分（按先后）。逐对扣，只在端点有 NaN 时用（见 `TakenIntervals`）。 */
function subtractPairwise(interval: [number, number], taken: ReadonlyArray<[number, number]>): Array<[number, number]> {
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
 * 前面的实例已经占去的区间。上千个实例时逐对扣是平方级（进转写页签的一半时间），这里记成按起点排好、互不相接（前一段的终点
 * 严格小于后一段的起点）的并集，扣与并都二分。扣出的段与逐对扣相同：都是 `[start, end]` 去掉这些开区间之后长度不为零的段、
 * 按先后，端点取自同样的数（比较都用严格的 `<` `>`，相等的数留先放进来的，±0 也一样）。
 * 端点有 NaN 时（`itemRangeSeconds` 由 ticks 字符串与帧率相除得来，坏数据会得出 NaN，`end <= start` 挡不住）比较总是假、
 * 并集不成立：从那以后改回逐对扣，所以 `raw` 留着全部区间。导出只为测试拿它与逐对扣对照（候选不按起点排时也一样）。
 */
export class TakenIntervals {
  readonly #merged: Array<[number, number]> = [];
  readonly #raw: Array<[number, number]> = [];
  #poisoned = false;

  subtract(start: number, end: number): Array<[number, number]> {
    if (this.#poisoned || Number.isNaN(start) || Number.isNaN(end)) return subtractPairwise([start, end], this.#raw);
    const merged = this.#merged;
    const parts: Array<[number, number]> = [];
    let cur = start;
    for (let i = partition(merged, ([, b]) => b <= start); i < merged.length && merged[i]![0] < end; i++) {
      const [a, b] = merged[i]!;
      if (a > cur) parts.push([cur, a]);
      if (b > cur) cur = b;
    }
    if (cur < end) parts.push([cur, end]);
    return parts;
  }

  add(start: number, end: number): void {
    this.#raw.push([start, end]);
    if (this.#poisoned) return;
    if (Number.isNaN(start) || Number.isNaN(end)) {
      this.#poisoned = true;
      return;
    }
    const merged = this.#merged;
    // 与它重叠或相接的是 [first, last)。
    const first = partition(merged, ([, b]) => b < start);
    const last = partition(merged, ([a]) => a <= end);
    let lo = start;
    let hi = end;
    if (first < last) {
      const [a] = merged[first]!;
      const [, b] = merged[last - 1]!;
      if (last - first === 1 && a <= start && b >= end) return;
      if (a <= lo) lo = a;
      if (b >= hi) hi = b;
    }
    merged.splice(first, last - first, [lo, hi]);
  }
}

/**
 * 词按开始时刻排好的下标与最长的词长：上千个实例 × 几万个词逐对投影要几百毫秒（进译文、文稿时），每个实例只取开始时刻
 * 可能落进它窗口的词（见 `wordsAround`）。时刻不是数的词（NaN）比较总是假，原来逐对时也逐个照试，这里同样每个实例都试。
 */
interface WordOrder {
  order: number[];
  longest: number;
  loose: number[];
}

function orderWords(words: readonly SpeechWord[]): WordOrder {
  const order: number[] = [];
  const loose: number[] = [];
  let longest = 0;
  words.forEach((word, index) => {
    if (Number.isNaN(word.start) || Number.isNaN(word.end)) {
      loose.push(index);
      return;
    }
    order.push(index);
    const length = word.end - word.start;
    if (!(length <= longest)) longest = length;
  });
  order.sort((x, y) => words[x]!.start - words[y]!.start);
  return { order, longest, loose };
}

/** 源时钟上 `[lo, hi)` 附近的词（下标按原来的先后）：只是候选，放宽一点免得舍入漏掉，投影与裁切仍逐个精确判。 */
function wordsAround({ order, longest, loose }: WordOrder, words: readonly SpeechWord[], lo: number, hi: number): number[] {
  const slack = 1e-6 * (1 + Math.abs(lo) + Math.abs(hi));
  const first = partition(order, (index) => words[index]!.start < lo - longest - slack);
  const last = partition(order, (index) => words[index]!.start <= hi + slack);
  const found = order.slice(first, Math.max(first, last));
  if (loose.length) found.push(...loose);
  return found.sort((x, y) => x - y);
}

/** 第一个让 `before` 为假的位置（`before` 在数组上先真后假）。 */
function partition<T>(list: readonly T[], before: (entry: T) => boolean): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (before(list[middle]!)) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** 时间线上能投影这个素材的实例（停用的也算，与导出相同）。 */
export function projectableItems(sequence: Sequence, assetId: Id): SequenceItem[] {
  return sequence.items.filter((item) => sourceAsset(item) === assetId && linearMap(item) !== null);
}

/**
 * 把素材时钟上的词投到序列上（text_plan.rs 的 `asset-items`）。范围外的词丢掉；跨剪辑点的词裁在区间里；
 * 结果按开始时刻、再按 `key` 排好。
 */
export function projectSpeech(sequence: Sequence, assetId: Id, words: readonly SpeechWord[]): PlacedWord[] {
  const fps = sequence.fps;
  const candidates = sequence.items
    .filter((item) => sourceAsset(item) === assetId)
    .map((item) => ({ item, bounds: itemRangeSeconds(item, fps) }))
    .sort((a, b) => a.bounds.start - b.bounds.start || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
  const taken = new TakenIntervals();
  const placed: PlacedWord[] = [];
  const ordered = orderWords(words);
  for (const { item, bounds } of candidates) {
    const map = linearMap(item);
    if (!map) continue;
    if (bounds.end <= bounds.start) continue;
    const windows = taken.subtract(bounds.start, bounds.end);
    taken.add(bounds.start, bounds.end);
    if (windows.length === 0) continue;
    const toSequence = (source: number) => bounds.start + (source - map.sourceIn) / map.rate;
    const toSource = (time: number) => map.sourceIn + (time - bounds.start) * map.rate;
    const lo = toSource(Math.min(...windows.map((w) => w[0])));
    const hi = toSource(Math.max(...windows.map((w) => w[1])));
    for (const index of wordsAround(ordered, words, lo, hi)) {
      const word = words[index]!;
      const a = toSequence(word.start);
      const b = toSequence(word.end);
      let piece = 0;
      for (const [from, to] of windows) {
        const start = Math.max(a, from);
        const end = Math.min(b, to);
        if (end <= start) continue;
        piece++;
        const base = `${item.id}:${word.id}`;
        placed.push({ ...word, key: piece === 1 ? base : `${base}#${piece}`, scopeItemId: item.id, start, end });
      }
    }
  }
  return placed.sort((x, y) => x.start - y.start || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}

// ---- 切条 ----

export interface DerivedCue {
  /** `q-` + 首词 ID（cue.rs）。 */
  id: string;
  start: number;
  end: number;
  text: string;
  /** 首词的说话人 ID。 */
  speaker?: string;
  wordIds: string[];
}

/** 远端导出在这两个词之间一定分句（`segmentsOf`），cue.rs 在说话人切换时一定断：这里都强制断开。 */
function mustBreak(last: SpeechWord, next: SpeechWord, first: SpeechWord): boolean {
  if (next.paragraphStart) return true;
  if ((last.speaker ?? null) !== (next.speaker ?? null)) return true;
  const known = last.sentenceId !== undefined || next.sentenceId !== undefined;
  if (known ? last.sentenceId !== next.sentenceId : next.start - last.end > PAUSE_SECONDS || SENTENCE_END.test(last.text.trim())) return true;
  // 远端 cuesOf 的 tooLong：一条不超过 7 秒。
  return next.end - first.start > EXPORT_MAX_CUE_SECONDS;
}

/** cue.rs 的 `auto_break` 阶梯：句末 > 从句标点（破折号门槛更低）> 长停顿 > 溢出（下一个词收在标点上且不超余量时延长收入）。 */
function autoBreak(word: SpeechWord, next: SpeechWord, lineWidth: number, projected: number, params: CueParams): boolean {
  const token = word.text.trim();
  if (sentenceEnd(token)) return true;
  const punct = clauseEndChar(token);
  if (punct !== null && lineWidth >= (punct === '—' || punct === '–' ? params.minDashChars : params.minClauseChars)) return true;
  if (next.start - word.end >= params.pauseSec && lineWidth >= params.minPauseChars) return true;
  if (projected > params.maxChars) {
    const nextToken = next.text.trim();
    const imminent = clauseEndChar(nextToken) !== null || sentenceEnd(nextToken);
    return !(imminent && projected <= params.maxChars + params.overflowSlack);
  }
  return false;
}

/**
 * 按素材时钟上的词切字幕条（cue.rs `derive_cues` 的贪心扫描），词按开始时刻排。`leading` 按整个词表判断一次，
 * 与远端一致。
 */
export function deriveCues(source: readonly SpeechWord[], params: CueParams = CUE_PARAMS): DerivedCue[] {
  const words = [...source].sort((a, b) => a.start - b.start);
  const leading = words.some((word) => /^\s/.test(word.text));
  const cues: DerivedCue[] = [];
  let current: SpeechWord[] = [];
  const flush = () => {
    if (!current.length) return;
    const first = current[0]!;
    cues.push({
      id: `q-${first.id}`,
      start: first.start,
      end: Math.max(...current.map((word) => word.end)),
      text: joinWords(
        current.map((word) => word.text),
        leading,
      ),
      ...(first.speaker !== undefined ? { speaker: first.speaker } : {}),
      wordIds: current.map((word) => word.id),
    });
    current = [];
  };
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    current.push(word);
    const next = words[i + 1];
    if (!next) break;
    if (mustBreak(word, next, current[0]!)) {
      flush();
      continue;
    }
    const tokens = current.map((w) => w.text);
    const lineWidth = displayWidth(joinWords(tokens, leading));
    const projected = displayWidth(joinWords([...tokens, next.text], leading));
    if (autoBreak(word, next, lineWidth, projected, params)) flush();
  }
  flush();
  return cues;
}

// ---- 写成字幕文档 ----

/**
 * 字幕条 → `baocut.caption/1` 正文：素材时钟、毫秒刻度，每条用 `words`（首词到末词）指向转写里的词。取整后照 text-export.ts 的 `quantize` 修：结束不早于开始、
 * 不压到下一条，取整撞在一起时把下一条的开始推到这一条的结束。只有出现两个以上说话人时才写 `speaker`（写显示名）。
 */
export function speechCaptionBody(cues: readonly DerivedCue[], speakers: ReadonlyMap<string, string>): Json {
  const many = new Set(cues.map((cue) => cue.speaker ?? '')).size > 1;
  const ticks = cues.map((cue) => ({ a: Math.round(cue.start * 1000), b: Math.round(cue.end * 1000) }));
  ticks.forEach((cue, i) => {
    const next = ticks[i + 1];
    if (next && cue.b > next.a) cue.b = next.a;
    if (cue.b <= cue.a) cue.b = cue.a + 1;
    if (next && next.a < cue.b) next.a = cue.b;
  });
  return {
    schema: CAPTION_SCHEMA,
    clock: 'source-asset',
    timescale: 1000,
    cues: cues.map((cue, i) => {
      const { a, b } = ticks[i]!;
      return {
        id: cue.id,
        start: a,
        end: b,
        text: cue.text,
        ...(many && cue.speaker !== undefined ? { speaker: speakers.get(cue.speaker) ?? cue.speaker } : {}),
        ...(cue.wordIds.length ? { words: { first: cue.wordIds[0]!, last: cue.wordIds[cue.wordIds.length - 1]! } } : {}),
      };
    }),
  };
}

/**
 * 素材时钟上的字幕实例放在哪：作用实例是时间线上取用这个素材的实例（按起点排），区间盖住它们。时间线上没有这样的实例时
 * （调用方先查过，不该发生）不写作用实例，区间盖住第一条到最后一条。
 */
export function captionPlacement(
  sequence: Sequence,
  assetId: Id,
  body: Json,
): { span: { fromFrame: number; durationFrames: number }; scopeItemIds: Id[] } {
  const cues = Array.isArray(body.cues) ? (body.cues as Array<{ start: number; end: number }>) : [];
  const scale = finite(body.timescale) || 1000;
  const perSecond = sequence.fps.num / sequence.fps.den;
  const scope = projectableItems(sequence, assetId)
    .map((item) => {
      const range = itemRangeSeconds(item, sequence.fps);
      return { item, frames: { start: Math.floor(range.start * perSecond + 1e-6), end: Math.ceil(range.end * perSecond - 1e-6) } };
    })
    .sort((a, b) => a.frames.start - b.frames.start || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
  if (scope.length) {
    const fromFrame = Math.min(...scope.map((s) => s.frames.start));
    return {
      span: { fromFrame, durationFrames: Math.max(1, Math.max(...scope.map((s) => s.frames.end)) - fromFrame) },
      scopeItemIds: scope.map((s) => s.item.id),
    };
  }
  const first = Math.min(...cues.map((cue) => cue.start)) / scale;
  const last = Math.max(...cues.map((cue) => cue.end)) / scale;
  const fromFrame = cues.length ? Math.max(0, Math.floor(first * perSecond + 1e-6)) : 0;
  const endFrame = cues.length ? Math.ceil(last * perSecond - 1e-6) : 1;
  return { span: { fromFrame, durationFrames: Math.max(1, endFrame - fromFrame) }, scopeItemIds: [] };
}

export const SPEECH_CAPTION_EXTENSION = 'baocut.speechCues';
const DOCUMENT_REF = 'speech-caption';
const NEW_TRACK = 'new-subtitle-track';

export interface SpeechCaptionSource {
  /** 文档与字幕实例的名字。 */
  name: string;
  language?: string;
  speechDocumentId: Id;
  speechRevision: string;
  assetId: Id;
  /** 新建字幕轨时的名字。 */
  trackName: string;
}

/**
 * 生成字幕的事务：写字幕文档（素材时钟，记下素材与来自哪份转写的哪个版本），放一个字幕实例：作用实例与区间见
 * `captionPlacement`。轨道的挑法与 `importCaptionOperations` 相同：字幕轨里有空着、没锁的就放进去，没有就新建一条。
 */
export function speechCaptionOperations(sequence: Sequence, body: Json, source: SpeechCaptionSource): EditOperation[] {
  const cues = Array.isArray(body.cues) ? body.cues : [];
  const { span, scopeItemIds } = captionPlacement(sequence, source.assetId, body);
  const free = sequence.tracks
    .filter((track) => track.kind === 'subtitle' && !track.locked)
    .sort((a, b) => a.order - b.order)
    .find((track) => trackFree(sequence, track.id, span.fromFrame, span.fromFrame + span.durationFrames));
  const operations: EditOperation[] = [];
  if (!free) operations.push({ type: 'addTrack', sequenceId: sequence.id, kind: 'subtitle', ref: NEW_TRACK, name: source.trackName });
  operations.push({
    type: 'putDocument',
    ref: DOCUMENT_REF,
    kind: 'caption',
    name: source.name,
    ...(source.language ? { language: source.language } : {}),
    sourceAsset: { assetId: source.assetId },
    sourceDocument: { documentId: source.speechDocumentId },
    body,
    summary: { cueCount: cues.length },
    extensions: {
      [SPEECH_CAPTION_EXTENSION]: {
        speechDocumentId: source.speechDocumentId,
        speechRevision: source.speechRevision,
        assetId: source.assetId,
      },
    },
  });
  operations.push({
    type: 'insertItems',
    sequenceId: sequence.id,
    items: [
      {
        type: 'caption',
        name: source.name,
        span,
        documentRef: DOCUMENT_REF,
        ...(scopeItemIds.length ? { scopeItemIds } : {}),
        ...(free ? { trackId: free.id } : { trackRef: NEW_TRACK }),
      },
    ],
  });
  return operations;
}

// ---- 句数 ----

const TERMINATOR_RUN = /[.!?\u{3002}\u{ff0e}\u{ff01}\u{ff1f}\u{2026}]+["'\u{201d}\u{2019}\u{300d}\u{300f}\u{ff09})\]\u{300b}]?/gu;
const CONTENT = /[\p{L}\p{N}]/u;

/**
 * 字幕面板统计里的「句」。口径：按列表次序把各条的文字接起来看，一串终止标点（。！？.!?…，后面可跟一个右引号或括号）
 * 收住它前面的内容算一句；紧跟着西文字母或数字的（`2.14`、`a.com`）不算；以 `.` 收尾的再按 cue.rs 的 `sentence_end`
 * 排除缩写与带点的词干（`Dr.`、`e.g.`、`U.S.`）。最后一段没收尾的话也算一句。没有字母或数字的条（纯标点、空白）不计。
 */
export function countSentences(texts: readonly string[]): number {
  let count = 0;
  let open = false;
  for (const value of texts) {
    let from = 0;
    for (const match of value.matchAll(TERMINATOR_RUN)) {
      const at = match.index;
      const end = at + match[0].length;
      const after = value[end];
      if (after !== undefined && /[A-Za-z0-9]/.test(after)) continue;
      const terminal = [...match[0]].filter((char) => TERMINAL.has(char)).at(-1);
      if (terminal === '.') {
        const tokenStart = Math.max(value.lastIndexOf(' ', at - 1) + 1, 0);
        if (!sentenceEnd(value.slice(tokenStart, end))) continue;
      }
      if (open || CONTENT.test(value.slice(from, at))) count++;
      open = false;
      from = end;
    }
    if (CONTENT.test(value.slice(from))) open = true;
  }
  return open ? count + 1 : count;
}
