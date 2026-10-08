import { EXPORT_MAX_CUE_SECONDS, type Id } from '@baocut/protocol';

/**
 * 转写（`baocut.speech/1`）→ 字幕条（`baocut.caption/1` 的正文）：在素材时钟上把词表贪心切成一条条字幕；译文的字幕条由
 * Speech Worker 切好，这里只写成字幕文档（`workerCaptionBody`）。固定流程建立字幕层（`caption-layer.ts`）用。
 *
 * 来源（modified）：照搬编辑器的 `packages/ui/src/model/speech-cues.ts`（`readSpeechWords`、`splitUntimed`、`deriveCues`、
 * `speechCaptionBody`），切法、取整与字幕条 ID 都相同，所以流程建的字幕层与编辑器里「生成字幕」建的是同一种东西。
 * 译文字幕条的 ID 与编辑器的「放上画面」相同（`q-<单元 ID>`，同一单元的后几条跟 `~n`），之后在编辑器里改一句译文时找得到它的几条。
 * 切条的贪心阶梯本身移植自旧版 `bcut-flow-core` 的 `cue.rs` / `atomize.rs`（规范 §18.5），细节见 UI 那份的说明。
 *
 * 智能体自己写的译文（没有 Worker 的字幕条）按句级对齐切条：`translationCues`，照搬编辑器的 `translation-cues.ts`。
 *
 * 架构偏差：这套规则本该只有一份（在 `crates/speech-doc`，与导出共用）。编辑器那份在 UI 的模型层，jobs 不能依赖 UI
 * （UI 也不能依赖只在 Node 里跑的 jobs），眼下各留一份；改切法时两处一起改（架构设计 §14「转录工具的字幕层」）。
 */

type Json = Record<string, unknown>;

export const CAPTION_SCHEMA = 'baocut.caption/1';

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

// ---- 字符规则 ----

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

/** 词拼成文字：词自带前导空格的原样接；否则西文、韩文词之间加空格，汉字、假名与标点前不加。 */
function joinCueWords(tokens: readonly string[], leadingSpaces: boolean): string {
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

// ---- 标点 ----

// i18n-ignore-start: 断句用的中英文标点集合
const CLOSERS = new Set(['”', '"', '’', "'", '」', '』', '）', ')', ']', '》']);
const TERMINAL = new Set(['。', '．', '.', '？', '?', '！', '!', '…']);
const CLAUSE_END = new Set([',', ';', ':', '—', '–', '，', '；', '：', '、']);
// i18n-ignore-end
/** 小写词干缩写表：`Dr.` 的句点不是句末。 */
// prettier-ignore
const SENTENCE_ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'sr', 'jr', 'rev', 'hon', 'fr', 'gen', 'gov', 'sen',
  'rep', 'col', 'lt', 'sgt', 'capt', 'vs', 'etc', 'inc', 'ltd', 'corp', 'dept', 'vol', 'fig',
]);

/** 句末：至多跳过一个右引号或括号后是终止标点；`.` 的词干里另有 `.` 或词干是缩写时不算。 */
function sentenceEnd(token: string): boolean {
  const chars = [...token];
  let index = chars.length;
  if (index > 0 && CLOSERS.has(chars[index - 1]!)) index--;
  if (index === 0) return false;
  const last = chars[index - 1]!;
  if (!TERMINAL.has(last)) return false;
  if (last === '.') {
    const stem = chars.slice(0, index - 1).join('');
    if (stem.includes('.')) return false;
    const bare = stem.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
    if (SENTENCE_ABBREV.has(bare)) return false;
  }
  return true;
}

/** 从句标点：至多跳过一个右引号或括号后的尾标点；不是时返回 null。 */
function clauseEndChar(token: string): string | null {
  const chars = [...token];
  let index = chars.length;
  if (index > 0 && CLOSERS.has(chars[index - 1]!)) index--;
  if (index === 0) return null;
  const last = chars[index - 1]!;
  return CLAUSE_END.has(last) ? last : null;
}

// ---- 读转写 ----

/** 转写里的一个词（素材时钟，秒）。 */
export interface CueWord {
  id: string;
  start: number;
  end: number;
  /** 原样保留（不 trim）：有的识别器用前导空格表示词间空白。 */
  text: string;
  speaker?: string;
  sentenceId?: string;
  /** 这一句标了段首、且这是句子的第一个成员。 */
  paragraphStart: boolean;
}

export interface CueWords {
  words: CueWord[];
  /** 说话人 ID → 显示名。 */
  speakers: Map<string, string>;
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * 读 `baocut.speech/1` 的词：跳过隐藏的、空白的与时长不为正的词；句子认 `wordIds` 与 `first` / `last` 两种写法。
 * 不是转写正文时返回 null。没有词时间的整段按 `splitUntimed` 拆开。
 */
export function readSpeechWords(body: unknown, params: CueParams = CUE_PARAMS): CueWords | null {
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
      if (first !== undefined && last !== undefined && first <= last)
        members = Array.from({ length: last - first + 1 }, (_, n) => first + n);
    }
    members.forEach((at, n) => (sentenceOf[at] = { id, paragraph: paragraph && n === 0 }));
  }
  const words: CueWord[] = [];
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
        if (previous) previous.text = joinCueWords([previous.text, value], leading);
        else carried = carried ? joinCueWords([carried, value], leading) : value;
        return;
      }
    }
    const speaker = text(word.speaker);
    const sentence = sentenceOf[i];
    const id = text(word.id) ?? '';
    const untimed = word.timingQuality === 'missing' || /\S\s+\S/.test(value.trim());
    const pieces = untimed
      ? splitUntimed(value, start / scale, end / scale, params.maxChars)
      : [{ text: value, start: start / scale, end: end / scale }];
    pieces.forEach((piece, n) =>
      words.push({
        id: n === 0 ? id : `${id}~${n + 1}`,
        start: piece.start,
        end: piece.end,
        text: n === 0 && carried ? joinCueWords([carried, piece.text], leading) : piece.text,
        ...(speaker !== undefined ? { speaker } : {}),
        ...(sentence ? { sentenceId: sentence.id } : {}),
        paragraphStart: n === 0 && (sentence?.paragraph ?? false),
      }),
    );
    carried = '';
  });
  if (carried && words.length) words[words.length - 1]!.text = joinCueWords([words[words.length - 1]!.text, carried], leading);
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
 * 没有词时间的一段拆成几块：在空白处与句末、从句标点之后断开，宽过 `maxChars` 的再按宽度切；时间按各块的显示宽度在
 * [start, end] 里线性分。拆不开时原样一块。
 */
export function splitUntimed(
  value: string,
  start: number,
  end: number,
  maxChars: number,
): Array<{ text: string; start: number; end: number }> {
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
    if ((WIDE.test(char) || WIDE.test(next)) && (sentenceEnd(current) || clauseEndChar(current) !== null)) push();
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

// ---- 切条 ----

export interface DerivedCue {
  /** `q-` + 首词 ID。 */
  id: string;
  start: number;
  end: number;
  text: string;
  /** 首词的说话人 ID。 */
  speaker?: string;
  /** 这一条的词（按开始时刻），写成字幕句子的 `words`。 */
  wordIds: string[];
}

/** 段首、换说话人、换句（没存句子时停顿超过 1 秒或句末标点）与一条超过 7 秒时一定断开。 */
function mustBreak(last: CueWord, next: CueWord, first: CueWord): boolean {
  if (next.paragraphStart) return true;
  if ((last.speaker ?? null) !== (next.speaker ?? null)) return true;
  const known = last.sentenceId !== undefined || next.sentenceId !== undefined;
  if (known ? last.sentenceId !== next.sentenceId : next.start - last.end > PAUSE_SECONDS || SENTENCE_END.test(last.text.trim()))
    return true;
  return next.end - first.start > EXPORT_MAX_CUE_SECONDS;
}

/** 断行阶梯：句末 > 从句标点（破折号门槛更低）> 长停顿 > 溢出（下一个词收在标点上且不超余量时延长收入）。 */
function autoBreak(word: CueWord, next: CueWord, lineWidth: number, projected: number, params: CueParams): boolean {
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

/** 按素材时钟上的词切字幕条（贪心扫描），词按开始时刻排。 */
export function deriveCues(source: readonly CueWord[], params: CueParams = CUE_PARAMS): DerivedCue[] {
  const words = [...source].sort((a, b) => a.start - b.start);
  const leading = words.some((word) => /^\s/.test(word.text));
  const cues: DerivedCue[] = [];
  let current: CueWord[] = [];
  const flush = () => {
    if (!current.length) return;
    const first = current[0]!;
    cues.push({
      id: `q-${first.id}`,
      start: first.start,
      end: Math.max(...current.map((word) => word.end)),
      text: joinCueWords(
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
    const lineWidth = displayWidth(joinCueWords(tokens, leading));
    const projected = displayWidth(joinCueWords([...tokens, next.text], leading));
    if (autoBreak(word, next, lineWidth, projected, params)) flush();
  }
  flush();
  return cues;
}

// ---- 译文切条 ----

/** 译文单元里切字幕要用的几项（`baocut.translation/2`，视频格式规范 §5.3）。 */
export interface CueTranslationUnit {
  id: Id;
  naturalText: string;
  displayRewrite?: { text: string } | undefined;
  alignment: { sourceWordIds: readonly Id[] } | null;
  status: string;
}

/** `w12~3`（没有词时间的段拆出来的块）→ `w12`。 */
const baseWordId = (id: string) => id.replace(/~\d+$/, '');

/**
 * 译文单元 → 字幕条（素材时钟，秒）：一句译文的时间取原句成员词（`alignment.sourceWordIds`）的时间，按 `splitUntimed`
 * 在空白与标点处拆开、时间按显示宽度插值，再交 `deriveCues` 贪心切条（一条不超过 7 秒、不跨出原句）。显示宽度按
 * `displayWidth`：汉字、假名、谚文与全角符号算 2，其余文字算 1；中文、日文按标点断，韩文与西文按空格断，两样都没有的
 * 文字（如泰文）按宽度切。标了过期的、没有译文的、原句的词一个也找不到的单元不出字幕。字幕条的 ID 是 `q-<单元 ID>`，
 * 同一句拆出来的后几条跟 `~n`。
 *
 * 来源（modified）：照搬编辑器的 `packages/ui/src/model/translation-cues.ts`（`translationCues`），切法、时间与 ID 都相同，
 * 所以智能体建的译文字幕层，之后在编辑器里改一句译文时 `retextCaption` 照样找得到它的几条。两份并存的原因见文件头的
 * 「架构偏差」；改切法时两处一起改，`caption-layer.test.ts` 用编辑器那份的样例核对两边相同。
 */
export function translationCues(speech: CueWords, units: readonly CueTranslationUnit[], params: CueParams = CUE_PARAMS): DerivedCue[] {
  const byBase = new Map<string, CueWord[]>();
  for (const word of speech.words) {
    const base = baseWordId(word.id);
    byBase.set(base, [...(byBase.get(base) ?? []), word]);
  }
  const pseudo: CueWord[] = [];
  for (const unit of units) {
    const value = (unit.displayRewrite?.text || unit.naturalText || '').trim();
    if (unit.status === 'stale' || !value) continue;
    const words = (unit.alignment?.sourceWordIds ?? []).flatMap((id) => byBase.get(id) ?? []);
    if (!words.length) continue;
    const start = Math.min(...words.map((w) => w.start));
    const end = Math.max(...words.map((w) => w.end));
    const speaker = words.find((w) => w.start === start)!.speaker;
    splitUntimed(value, start, end, params.maxChars).forEach((piece, n) => {
      pseudo.push({
        id: n === 0 ? unit.id : `${unit.id}~${n + 1}`,
        start: piece.start,
        end: piece.end,
        text: piece.text.trim(),
        ...(speaker !== undefined ? { speaker } : {}),
        // 一句译文自成一句：不和相邻的译文接成一条。
        sentenceId: unit.id,
        paragraphStart: false,
      });
    });
  }
  return deriveCues(pseudo, params);
}

// ---- 写成字幕文档 ----

/**
 * 字幕条 → `baocut.caption/1` 正文：素材时钟、毫秒刻度。取整后修：结束不早于开始、不压到下一条，取整撞在一起时把下一条
 * 的开始推到这一条的结束。只有出现两个以上说话人时才写 `speaker`（写显示名）。
 */
export function captionBody(cues: readonly DerivedCue[], speakers: ReadonlyMap<string, string>): Json {
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
        ...wordRange(cue.wordIds),
      };
    }),
  };
}

/** 字幕句子指向转写里的哪些词（视频格式规范 §3.8）：首词到末词。渲染按它取词做逐词动画与强调。 */
function wordRange(wordIds: readonly string[]): { words?: { first: string; last: string } } {
  return wordIds.length ? { words: { first: wordIds[0]!, last: wordIds[wordIds.length - 1]! } } : {};
}

/**
 * Speech Worker 切好的译文字幕条 → `baocut.caption/1` 正文：素材时钟、转写的刻度（整数刻度原样写，不经秒）。字幕条的 ID 是
 * `q-<单元 ID>`，同一单元的后几条跟 `~2`、`~3`……；只有出现两个以上说话人时才写 `speaker`（写显示名）。
 */
export function workerCaptionBody(
  cues: { timescale: number; cues: ReadonlyArray<{ unitId: Id | null; sentenceId: Id; text: string; start: number; end: number }> },
  sentenceSpeakers: ReadonlyMap<string, string>,
  speakers: ReadonlyMap<string, string>,
): Json {
  const seen = new Map<string, number>();
  const rows = cues.cues
    .filter((cue) => cue.text.trim() !== '' && cue.end > cue.start)
    .map((cue) => {
      const base = `q-${cue.unitId ?? cue.sentenceId}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const speaker = sentenceSpeakers.get(cue.sentenceId);
      return { id: n === 1 ? base : `${base}~${n}`, start: cue.start, end: cue.end, text: cue.text.trim(), speaker };
    });
  const many = new Set(rows.map((row) => row.speaker ?? '')).size > 1;
  return {
    schema: CAPTION_SCHEMA,
    clock: 'source-asset',
    timescale: cues.timescale,
    cues: rows.map(({ speaker, ...row }) => ({
      ...row,
      ...(many && speaker !== undefined ? { speaker: speakers.get(speaker) ?? speaker } : {}),
    })),
  };
}
