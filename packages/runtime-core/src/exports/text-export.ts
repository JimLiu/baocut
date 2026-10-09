import {
  EXPORT_MAX_CHARS_PER_LINE,
  EXPORT_MAX_CUE_SECONDS,
  EXPORT_MAX_LINES_PER_CUE,
  refOf,
  TRANSCRIPT_PARAGRAPH,
  transcriptMarkdownText as markdownText,
  transcriptOneLine as oneLine,
  transcriptStamp,
  type JobWarning,
  type Localized,
  type SubtitleExportFormat,
  type TranscriptExportFormat,
} from '@baocut/protocol';
import { sourceSentences } from '@baocut/jobs';
import { JobsSpeechDocument } from '@baocut/protocol/messages/jobs/speech-document.ts';
import { RcExport } from '@baocut/protocol/messages/runtime-core';
import type { PlannedDocument, TextEntry, TextPlan } from './export-plan.ts';
import { assStyleMapping } from './ass-style.ts';

/**
 * 字幕与文稿的写出（架构设计 §9.13）：把引擎投影到时间线上的条目（`TextPlan`，已经去掉了被剪掉的词）拼成句子、
 * 拆成字幕条，写成 SRT、VTT、ASS、JSON、Markdown 或纯文本；写完再按同一种格式解析回来，条数与时间对得上才算通过。
 *
 * - 时间是相对导出范围起点的秒（文件从 0 开始），全部来自引擎的投影；这里只做取整与重叠修复。
 * - 词时间不可信（插值、缺失）的词不写逐词时间（验收 AT-05）；只有句子级时间的文档，JSON 里没有 `words`。
 * - 双语合并：译文按句子（或字幕条）ID 配；句子被剪得不完整时不配译文（格式规范 §5.7），记一条警告。
 *   另一份带时间的文档按时间重叠配到主文档的句子上。译文认两种正文（格式规范 §5.3）：`baocut.translation/2`
 *   （单元按 `sourceSentenceId` 配，成员是 `alignment.sourceWordIds`；`alignment` 为 null 的单元，成员取按字幕与翻译核心的
 *   规则从转写的词得出的那一句，与翻译时的句子相同；转写没有存句子时，句子也按成员切）与旧项目导入的
 *   `baocut.translation/1`（单元的 `id` 就是句子 ID，成员取转写的句子）。
 */

export type TextFormat = SubtitleExportFormat | TranscriptExportFormat;

export interface TextExportInput {
  kind: 'subtitles' | 'transcript';
  format: TextFormat;
  primary: { document: PlannedDocument; plan: TextPlan };
  secondary: { document: PlannedDocument; plan: TextPlan | null } | null;
  /** 主文档的第一个字幕实例的样式文档（ASS 用）。 */
  style: unknown;
  canvas: { width: number; height: number };
  meta: { videoId: string; videoName: string; videoRevision: string; sequenceId: string; sequenceRevision: string };
  /** 时间的范围（秒）：导出范围的时长；`skipCut: false` 时是原文的跨度（`sourcePlan`）。 */
  rangeDuration: number;
  maxCharsPerLine?: number;
  /** 文稿（Markdown、纯文本）在每段末尾写段首的时间（`[mm:ss]`，满一小时 `[hh:mm:ss]`）。 */
  timestamps?: boolean;
  /** 文稿写说话人：每段都写（段里有说话人时），默认 true。 */
  speakers?: boolean;
  /** 文稿的章节小标题（与条目同一个时间基准，按开始排好）；null 或不给时不写。 */
  chapters?: TextChapter[] | null;
  /** Markdown 文稿的文首元信息；null 或不给时不写，纯文本与 JSON 不写。 */
  frontMatter?: FrontMatter | null;
}

/** 章节（序列上 `kind: 'chapter'` 的标记）：标题与开始的时刻。 */
export interface TextChapter {
  title: string;
  start: number;
}

/**
 * 文首元信息（YAML）的字段，按这个顺序写；缺的（null、空串）整行不写。说话人与章节由正文得出，接在后面。
 * 与设计稿 model-transcript.js 的 `frontmatter()`、v2 的 `--frontmatter` 同一份字段与写法。
 */
export interface FrontMatter {
  title: string | null;
  description: string | null;
  source: string | null;
  author: string | null;
  published: string | null;
  platform: string | null;
  duration: string | null;
  language: string | null;
  translation: string | null;
}

export interface TextExportOutput {
  content: string;
  /** 写出的条数：字幕是条，JSON 是句子，Markdown 与纯文本是段落。 */
  entries: number;
  /** 最后一条的结束时间（秒）。 */
  durationSec: number;
  /** 主文档正文里的拉丁词数与汉字数（不含标题、说话人、时间码与译文），界面说篇幅用。 */
  words: number;
  cjkCharacters: number;
  /** 纯文本文稿里章节小标题的块数：校验数段落时扣掉它们（小标题与正文同样是一块文字，看格式分不清）。 */
  headings: number;
  warnings: JobWarning[];
  /** 校验时的范围（秒）：即 `TextExportInput.rangeDuration`。 */
  rangeSec: number;
}

export interface TextWord {
  id: string;
  text: string;
  start: number;
  end: number;
  timed: boolean;
}

/** 一句（或一条字幕）：拆字幕条、写文稿与 JSON 的单位。 */
export interface TextSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  translation: string | null;
  /** 配译文用：转写的句子 ID，字幕文档的字幕条 ID；没有句子切分的转写为 null。 */
  sentenceId: string | null;
  paragraphStart: boolean;
  /** 转写的词；字幕文档为 null。 */
  words: TextWord[] | null;
}

interface Cue {
  start: number;
  end: number;
  lines: string[];
  secondary: string[];
}

/** 句与句之间超过这么长的停顿就分句（没有句子切分的转写用）。 */
const PAUSE_SECONDS = 1;
const SENTENCE_END = /[.!?。！？…]["'”’）)\]]*$/u;
const NO_SPACE_BEFORE = /^[,.!?;:%)\]}'’”…，。！？；：、）」』】》]/u;
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3fffd}]/u;

/** 显示宽度：全角字算 2。 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += WIDE.test(char) ? 2 : 1;
  return width;
}

/** 词拼成文字：词自带前导空格的（一些识别器的习惯）原样接；否则西文词之间加空格，全角字与标点前不加。 */
export function joinWords(tokens: string[], leadingSpaces: boolean): string {
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
    const space = !WIDE.test(prev) && !WIDE.test(next) && !NO_SPACE_BEFORE.test(token);
    out += space ? ` ${token}` : token;
  }
  return out;
}

/** 折行：保留原有的换行；超宽的行在空格处（西文）或按宽度（全角，标点不放行首）断开。 */
export function wrapLines(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const trimmed = paragraph.replace(/\s+/g, ' ').trim();
    if (!trimmed) continue;
    let rest = trimmed;
    while (displayWidth(rest) > maxWidth) {
      const chars = [...rest];
      let width = 0;
      let cut = 0;
      let lastSpace = -1;
      for (let i = 0; i < chars.length; i++) {
        const w = WIDE.test(chars[i]!) ? 2 : 1;
        if (width + w > maxWidth) break;
        width += w;
        cut = i + 1;
        if (chars[i] === ' ') lastSpace = i;
      }
      if (lastSpace > 0 && !WIDE.test(chars[cut] ?? '')) cut = lastSpace;
      // 行首不放标点：把它留在上一行。
      while (cut < chars.length && NO_SPACE_BEFORE.test(chars[cut]!)) cut++;
      if (cut <= 0) cut = 1;
      lines.push(chars.slice(0, cut).join('').trim());
      rest = chars.slice(cut).join('').trim();
    }
    if (rest) lines.push(rest);
  }
  return lines;
}

// ---- 句子 ----

interface SpeechBody {
  speakers?: Array<{ id: string; name?: string }>;
  words?: Array<{ id: string; start?: number; end?: number; hidden?: boolean; text?: string }>;
  sentences?: Array<{ id: string; first?: string; last?: string; wordIds?: string[] }> | null;
}

interface TranslationBody {
  schema?: string;
  units?: Array<{
    id: string;
    // baocut.translation/1（旧项目导入）
    text?: string;
    display?: string;
    // baocut.translation/2（§5.3）
    sourceSentenceId?: string;
    sourceFingerprint?: string;
    naturalText?: string;
    displayRewrite?: { text?: string };
    alignment?: { sourceWordIds?: string[] } | null;
    status?: string;
  }>;
}

/** 读出的译文：句子 ID → 译文；`/2` 还带每句的词成员（不含隐藏的词）。 */
interface Translation {
  texts: Map<string, string>;
  members: Map<string, Set<string>> | null;
  /** 标成过期（`status: 'stale'`）而不用的单元数。 */
  stale: number;
}

const TRANSLATION_V2 = 'baocut.translation/2';

/** 转写按字幕与翻译核心的规则得出的句子：句子 ID → 指纹与（可见的）词。 */
type DerivedSentences = Map<string, { fingerprint: string; wordIds: string[] }>;

/**
 * `alignment` 为 null 的 `/2` 单元（智能体自己写的译文，§5.3 允许）没有记下成员：按翻译时同一套规则从主文档（转写）的词
 * 重新得出句子（`sourceSentences`，经 editor-wasm），取那一句的词。只在用得上时算一次。句子的 WASM 没有构建时照样抛出
 * （`EditorWasmUnavailable`），导出失败而不是悄悄少了译文。
 */
function sentenceDeriver(primary: PlannedDocument): () => DerivedSentences | null {
  let derived: DerivedSentences | null | undefined;
  return () => {
    if (derived !== undefined) return derived;
    const read = sourceSentences(primary.body);
    derived =
      'problem' in read ? null : new Map(read.sentences.map((s) => [s.id, { fingerprint: s.fingerprint, wordIds: [...s.wordIds] }]));
    return derived;
  };
}

/**
 * 读译文。`derive` 给出转写此刻的句子：`alignment` 为 null 的单元按它取成员，指纹与单元记下的不同（原句改过）时不用它，
 * 记为过期。
 */
function translationOf(body: TranslationBody | null, derive: (() => DerivedSentences | null) | null): Translation {
  const units = Array.isArray(body?.units) ? body.units : [];
  if (body?.schema !== TRANSLATION_V2) {
    return { texts: new Map(units.map((u) => [u.id, (u.display ?? u.text ?? '').trim()])), members: null, stale: 0 };
  }
  const texts = new Map<string, string>();
  const members = new Map<string, Set<string>>();
  let stale = 0;
  for (const unit of units) {
    if (typeof unit.sourceSentenceId !== 'string') continue;
    if (unit.status === 'stale') {
      stale++;
      continue;
    }
    const ids = unit.alignment?.sourceWordIds;
    if (Array.isArray(ids)) members.set(unit.sourceSentenceId, new Set(ids));
    else if (unit.alignment === null && derive) {
      const sentence = derive()?.get(unit.sourceSentenceId);
      if (sentence && unit.sourceFingerprint && unit.sourceFingerprint !== sentence.fingerprint) {
        stale++;
        continue;
      }
      if (sentence) members.set(unit.sourceSentenceId, new Set(sentence.wordIds));
    }
    texts.set(unit.sourceSentenceId, (unit.displayRewrite?.text?.trim() || unit.naturalText || '').trim());
  }
  return { texts, members, stale };
}

/** 转写没有存句子时，按 `/2` 译文的词成员给条目标上句子 ID（翻译时就是按这些句子译的）。 */
function withTranslationSentences(
  entries: TextEntry[],
  secondary: TextExportInput['secondary'],
  translation: Translation | null,
): TextEntry[] {
  if (!secondary || secondary.plan !== null || !translation || entries.some((e) => e.sentenceId !== undefined)) return entries;
  const members = translation.members;
  if (!members || members.size === 0) return entries;
  const sentenceOf = new Map<string, string>();
  for (const [sentenceId, ids] of members) for (const id of ids) sentenceOf.set(id, sentenceId);
  return entries.map((e) => {
    const sentenceId = sentenceOf.get(e.id);
    return sentenceId === undefined ? e : { ...e, sentenceId };
  });
}

/** 转写正文里每句（未隐藏的）词。 */
function sentenceMembers(body: SpeechBody | null): Map<string, Set<string>> {
  const members = new Map<string, Set<string>>();
  if (!body?.sentences || !Array.isArray(body.words)) return members;
  const hidden = new Set(body.words.filter((w) => w.hidden).map((w) => w.id));
  const order = new Map(body.words.map((w, i) => [w.id, i]));
  for (const sentence of body.sentences) {
    let ids: string[] = [];
    if (Array.isArray(sentence.wordIds)) ids = sentence.wordIds;
    else if (sentence.first !== undefined && sentence.last !== undefined) {
      const a = order.get(sentence.first);
      const b = order.get(sentence.last);
      if (a !== undefined && b !== undefined) ids = body.words.slice(a, b + 1).map((w) => w.id);
    }
    members.set(sentence.id, new Set(ids.filter((id) => !hidden.has(id))));
  }
  return members;
}

/**
 * 转写正文里本来就放不上字幕的词：时长不为正（`end <= start`，转写给的词时间塌成一点）或没有文字。规划（`text_plan.rs`）
 * 不出这些词，但它们不是剪掉的——配整句译文时不把它们算作缺的成员。隐藏的词不在其中：隐藏是用户的剪辑。
 */
function unplaceableWords(body: SpeechBody | null): Set<string> {
  const ids = new Set<string>();
  for (const word of body?.words ?? []) {
    if (word.hidden) continue;
    const timeless = typeof word.start === 'number' && typeof word.end === 'number' && word.end <= word.start;
    if (timeless || (typeof word.text === 'string' && word.text.trim() === '')) ids.add(word.id);
  }
  return ids;
}

/** 说话人的显示名；没有名字的用转写时的默认名（「说话人 N」）。 */
function speakerNames(primary: PlannedDocument): Map<string, string> {
  const body = (primary.body ?? null) as SpeechBody | null;
  return new Map((body?.speakers ?? []).map((s, i) => [s.id, s.name?.trim() || JobsSpeechDocument.speakerName({ n: i + 1 }).text]));
}

/** 主文档的条目拼成句子（字幕文档一条就是一句）。 */
export function segmentsOf(input: Pick<TextExportInput, 'primary' | 'secondary'>, warnings: JobWarning[]): TextSegment[] {
  const { plan, document } = input.primary;
  const names = speakerNames(document);
  const speakerOf = (id: string | undefined) => (id === undefined ? null : (names.get(id) ?? id));
  // 译文（不带时间的另一份文档）读一次：切句与配译文用同一份成员。
  const translation =
    input.secondary && input.secondary.plan === null
      ? translationOf(input.secondary.document.body as TranslationBody | null, plan.unit === 'speech' ? sentenceDeriver(document) : null)
      : null;
  let segments: TextSegment[];
  if (plan.unit === 'caption') {
    segments = plan.entries.map((e) => ({
      id: e.key,
      start: e.start,
      end: e.end,
      text: e.text.trim(),
      speaker: speakerOf(e.speaker),
      translation: null,
      sentenceId: e.id,
      paragraphStart: e.paragraphStart === true,
      words: null,
    }));
  } else {
    const entries = withTranslationSentences(plan.entries, input.secondary, translation);
    const leading = entries.some((e) => /^\s/.test(e.text));
    const runs: TextEntry[][] = [];
    let run: TextEntry[] = [];
    for (const entry of entries) {
      const last = run.at(-1);
      // 知道句子时按句子切（句子里的停顿、说话人由切句的规则决定，这里不再拆）；不知道时按停顿、说话人与句末标点切。
      const known = last !== undefined && (last.sentenceId !== undefined || entry.sentenceId !== undefined);
      const split =
        last !== undefined &&
        (last.scopeItemId !== entry.scopeItemId ||
          entry.paragraphStart === true ||
          (known
            ? last.sentenceId !== entry.sentenceId
            : last.speaker !== entry.speaker || entry.start - last.end > PAUSE_SECONDS || SENTENCE_END.test(last.text.trim())));
      if (split) {
        runs.push(run);
        run = [];
      }
      run.push(entry);
    }
    if (run.length > 0) runs.push(run);
    segments = runs.map((words, i) => ({
      id: words[0]!.sentenceId !== undefined ? `${words[0]!.scopeItemId ?? ''}:${words[0]!.sentenceId}` : `run-${i + 1}`,
      start: words[0]!.start,
      end: Math.max(...words.map((w) => w.end)),
      text: joinWords(
        words.map((w) => w.text),
        leading,
      ),
      speaker: speakerOf(words[0]!.speaker),
      translation: null,
      sentenceId: words[0]!.sentenceId ?? null,
      paragraphStart: words[0]!.paragraphStart === true || i === 0 || words[0]!.speaker !== runs[i - 1]!.at(-1)!.speaker,
      words: words.map((w) => ({ id: w.id, text: w.text.trim(), start: w.start, end: w.end, timed: w.wordTiming })),
    }));
  }
  attachSecondary(input, segments, warnings, translation);
  return segments;
}

function attachSecondary(
  input: Pick<TextExportInput, 'primary' | 'secondary'>,
  segments: TextSegment[],
  warnings: JobWarning[],
  translation: Translation | null,
): void {
  const secondary = input.secondary;
  if (!secondary) return;
  if (secondary.plan === null) {
    if (!translation) return;
    const body = input.primary.document.body as SpeechBody | null;
    const members = input.primary.plan.unit !== 'speech' ? null : (translation.members ?? sentenceMembers(body));
    const unplaceable = members ? unplaceableWords(body) : new Set<string>();
    let partial = 0;
    for (const segment of segments) {
      const unitId = segment.sentenceId;
      if (unitId === null) continue;
      const text = translation.texts.get(unitId);
      if (!text) continue;
      if (members) {
        // 句子被剪得不完整时不配整句的译文（格式规范 §5.7）；放不上字幕的词（零时长、没有文字）不算剪掉，两边都不数它。
        const expected = new Set([...(members.get(unitId) ?? [])].filter((id) => !unplaceable.has(id)));
        const present = new Set((segment.words ?? []).map((w) => w.id).filter((id) => !unplaceable.has(id)));
        if (!members.has(unitId) || expected.size !== present.size || [...expected].some((id) => !present.has(id))) {
          partial++;
          continue;
        }
      }
      segment.translation = text;
    }
    if (partial > 0) warn(warnings, 'TRANSLATION_SKIPPED_PARTIAL_SENTENCE', RcExport.translationPartialSkipped({ count: partial }));
    if (translation.stale > 0)
      warn(warnings, 'TRANSLATION_SKIPPED_STALE', RcExport.translationStale({ count: translation.stale }));
    return;
  }
  // 另一份带时间的文档：每条按中点归到所在的句子。
  const other = segmentsOf({ primary: { document: secondary.document, plan: secondary.plan }, secondary: null }, warnings);
  const buckets = new Map<TextSegment, string[]>();
  let unmatched = 0;
  for (const item of other) {
    const mid = (item.start + item.end) / 2;
    const owner = segments.find((s) => mid >= s.start && mid < s.end);
    if (!owner) {
      unmatched++;
      continue;
    }
    buckets.set(owner, [...(buckets.get(owner) ?? []), item.text]);
  }
  for (const [segment, texts] of buckets) segment.translation = texts.join(' ');
  if (unmatched > 0) warn(warnings, 'BILINGUAL_UNMATCHED', RcExport.bilingualUnmatched({ count: unmatched }));
}

// ---- 字幕条 ----

function cuesOf(segments: TextSegment[], maxWidth: number, warnings: JobWarning[]): Cue[] {
  const cues: Cue[] = [];
  const capacity = maxWidth * EXPORT_MAX_LINES_PER_CUE;
  let estimatedSplits = 0;
  for (const segment of segments) {
    const secondary = segment.translation ? wrapLines(segment.translation, maxWidth) : [];
    // 字幕文档没有词时间、双语的句子要与译文对齐：都不拆，整句一条。
    const fits = displayWidth(segment.text) <= capacity && segment.end - segment.start <= EXPORT_MAX_CUE_SECONDS;
    if (!segment.words || segment.translation !== null || fits) {
      cues.push({ start: segment.start, end: segment.end, lines: wrapLines(segment.text, maxWidth), secondary });
      continue;
    }
    const before = cues.length;
    const leading = segment.words.some((w) => /^\s/.test(w.text));
    let group: TextWord[] = [];
    const flush = () => {
      if (group.length === 0) return;
      const text = joinWords(
        group.map((w) => w.text),
        leading,
      );
      cues.push({ start: group[0]!.start, end: Math.max(...group.map((w) => w.end)), lines: wrapLines(text, maxWidth), secondary: [] });
      group = [];
    };
    for (const word of segment.words) {
      const candidate = joinWords([...group.map((w) => w.text), word.text], leading);
      const tooWide = group.length > 0 && displayWidth(candidate) > capacity;
      const tooLong = group.length > 0 && word.end - group[0]!.start > EXPORT_MAX_CUE_SECONDS;
      if (tooWide || tooLong) {
        // 尽量在标点处断：退回到组里最后一个以标点结尾的词之后。
        const punct = group.findLastIndex((w, i) => i > 0 && /[,，、;；:：.。!！?？]$/u.test(w.text));
        if (punct > 0 && punct < group.length - 1) {
          const carry = group.slice(punct + 1);
          group = group.slice(0, punct + 1);
          flush();
          group = carry;
        } else flush();
      }
      group.push(word);
    }
    flush();
    if (cues.length - before > 1 && segment.words.some((w) => !w.timed)) estimatedSplits++;
  }
  if (estimatedSplits > 0) {
    warn(warnings, 'CUE_SPLIT_AT_ESTIMATED_TIMES', RcExport.cueSplitEstimated({ count: estimatedSplits }));
  }
  return cues;
}

/** 按格式的时间单位取整（毫秒或百分之一秒），再修：结束不早于开始，不与下一条重叠。 */
function quantize(cues: Cue[], unitsPerSecond: number): Array<Cue & { a: number; b: number }> {
  const sorted = [...cues].sort((x, y) => x.start - y.start || x.end - y.end);
  const out = sorted.map((cue) => ({ ...cue, a: Math.round(cue.start * unitsPerSecond), b: Math.round(cue.end * unitsPerSecond) }));
  for (let i = 0; i < out.length; i++) {
    const cue = out[i]!;
    const next = out[i + 1];
    if (next && cue.b > next.a) cue.b = next.a;
    if (cue.b <= cue.a) cue.b = cue.a + 1;
    if (next && next.a < cue.b) next.a = cue.b;
  }
  return out;
}

function clock(units: number, unitsPerSecond: number, separator: string, hourDigits = 2): string {
  const fracDigits = unitsPerSecond === 1000 ? 3 : 2;
  const totalSeconds = Math.floor(units / unitsPerSecond);
  const frac = units - totalSeconds * unitsPerSecond;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(hourDigits, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${separator}${String(frac).padStart(fracDigits, '0')}`;
}

/** SRT 的文字：空行会结束这一条，`-->` 会被当成时间行。 */
function srtText(line: string): string {
  return line.replace(/-->/g, '→').trim();
}

function vttText(line: string): string {
  return line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
}

/** 记一条任务警告：文字按当前语言，另带引用。 */
function warn(warnings: JobWarning[], code: string, detail: Localized): void {
  warnings.push({ code, detail: detail.text, detailRef: refOf(detail) });
}

function assText(line: string): string {
  // i18n-ignore: ASS 转义用的全角替代字符
  return line.replace(/\\/g, '＼').replace(/\{/g, '｛').replace(/\}/g, '｝').trim();
}

function writeSrt(cues: Cue[]): { content: string; entries: number; end: number } {
  const timed = quantize(cues, 1000).filter((c) => c.lines.length > 0);
  const blocks = timed.map(
    (c, i) => `${i + 1}\n${clock(c.a, 1000, ',')} --> ${clock(c.b, 1000, ',')}\n${[...c.lines, ...c.secondary].map(srtText).join('\n')}\n`,
  );
  return { content: blocks.join('\n'), entries: timed.length, end: (timed.at(-1)?.b ?? 0) / 1000 };
}

function writeVtt(cues: Cue[]): { content: string; entries: number; end: number } {
  const timed = quantize(cues, 1000).filter((c) => c.lines.length > 0);
  const blocks = timed.map(
    (c) => `${clock(c.a, 1000, '.')} --> ${clock(c.b, 1000, '.')}\n${[...c.lines, ...c.secondary].map(vttText).join('\n')}\n`,
  );
  return { content: ['WEBVTT\n', ...blocks].join('\n'), entries: timed.length, end: (timed.at(-1)?.b ?? 0) / 1000 };
}

function writeAss(cues: Cue[], input: TextExportInput, warnings: JobWarning[]): { content: string; entries: number; end: number } {
  const timed = quantize(cues, 100).filter((c) => c.lines.length > 0);
  const mapping = assStyleMapping(input.style, input.canvas);
  if (mapping.unmapped.length > 0) {
    const styles = mapping.unmapped.join(RcExport.listSeparator().text);
    warn(warnings, 'ASS_STYLE_UNMAPPED', RcExport.assStyleUnmapped({ styles }));
  }
  const events = timed.map((c) => {
    const source = c.lines.map(assText).join('\\N');
    const translation = c.secondary.length > 0 ? `{\\rTranslation}${c.secondary.map(assText).join('\\N')}` : null;
    const text =
      translation === null ? source : mapping.translationFirst ? `${translation}\\N{\\rDefault}${source}` : `${source}\\N${translation}`;
    return `Dialogue: 0,${clock(c.a, 100, '.', 1)},${clock(c.b, 100, '.', 1)},Default,,0,0,0,,${text}`;
  });
  const content = [
    '[Script Info]',
    `Title: ${assText(input.meta.videoName)}`,
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${input.canvas.width}`,
    `PlayResY: ${input.canvas.height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    mapping.styles.default,
    mapping.styles.translation,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
  return { content, entries: timed.length, end: (timed.at(-1)?.b ?? 0) / 100 };
}

function writeJson(input: TextExportInput, segments: TextSegment[]): { content: string; entries: number; end: number } {
  const { primary, secondary, meta } = input;
  let timed = 0;
  let untimed = 0;
  const out = segments.map((s) => {
    const allTimed = s.words !== null && s.words.length > 0 && s.words.every((w) => w.timed);
    if (s.words !== null) {
      if (allTimed) timed++;
      else untimed++;
    }
    return {
      id: s.id,
      start: round3(s.start),
      end: round3(s.end),
      text: s.text,
      ...(s.speaker && input.speakers !== false ? { speaker: s.speaker } : {}),
      ...(s.translation ? { translation: s.translation } : {}),
      ...(s.paragraphStart ? { paragraphStart: true } : {}),
      // 只有每个词的时间都可信时才写逐词时间（验收 AT-05）。
      ...(allTimed ? { words: s.words!.map((w) => ({ id: w.id, text: w.text, start: round3(w.start), end: round3(w.end) })) } : {}),
    };
  });
  const body = {
    schema: 'baocut.export.text/1',
    video: { id: meta.videoId, name: meta.videoName, revision: meta.videoRevision },
    sequence: { id: meta.sequenceId, revision: meta.sequenceRevision },
    document: {
      id: primary.document.documentId,
      kind: primary.document.kind,
      language: primary.document.language,
      revision: primary.document.revision,
    },
    ...(secondary
      ? {
          translation: {
            id: secondary.document.documentId,
            kind: secondary.document.kind,
            language: secondary.document.language,
            revision: secondary.document.revision,
          },
        }
      : {}),
    /** 时间是相对导出范围起点的秒。 */
    duration: round3(input.rangeDuration),
    wordTiming: timed > 0 && untimed === 0 ? 'word' : timed > 0 ? 'partial' : 'none',
    segments: out,
  };
  return { content: `${JSON.stringify(body, null, 2)}\n`, entries: out.length, end: Math.max(0, ...out.map((s) => s.end)) };
}

interface Paragraph {
  start: number;
  speaker: string | null;
  text: string;
  translation: string | null;
}

/**
 * 句子分段，与编辑器的文稿面板同一套规则（`TRANSCRIPT_PARAGRAPH`）：标了段首、换了说话人、停顿够长时断，
 * 句末处这段够长了（或停顿稍长且不太短）也断。转写多半没有存段落，只按段首与说话人分时，独白会成为一整段。
 * 写章节小标题时，章节的开始处也断（`breaks`），小标题才不会落在一段的中间。
 */
function paragraphsOf(segments: TextSegment[], breaks: readonly number[] = []): Paragraph[] {
  const paragraphs: Array<{ start: number; speaker: string | null; parts: TextSegment[]; width: number }> = [];
  for (const segment of segments) {
    const last = paragraphs.at(-1);
    const prev = last?.parts.at(-1);
    const gap = prev ? segment.start - prev.end : 0;
    const ended = prev ? SENTENCE_END.test(prev.text) : false;
    const chapter = prev ? breaks.some((at) => prev.start < at && segment.start >= at) : false;
    if (
      !last ||
      segment.paragraphStart ||
      chapter ||
      segment.speaker !== last.speaker ||
      gap >= TRANSCRIPT_PARAGRAPH.pauseSec ||
      (ended &&
        (last.width >= TRANSCRIPT_PARAGRAPH.maxWidth ||
          (gap >= TRANSCRIPT_PARAGRAPH.sentencePauseSec && last.width >= TRANSCRIPT_PARAGRAPH.minWidth)))
    ) {
      paragraphs.push({ start: segment.start, speaker: segment.speaker, parts: [segment], width: [...segment.text].length });
    } else {
      last.parts.push(segment);
      last.width += 1 + [...segment.text].length;
    }
  }
  return paragraphs.map((p) => ({
    start: p.start,
    speaker: p.speaker,
    text: joinSentences(p.parts.map((s) => s.text)),
    translation: p.parts.some((s) => s.translation) ? joinSentences(p.parts.map((s) => s.translation ?? '').filter(Boolean)) : null,
  }));
}

function joinSentences(texts: string[]): string {
  return joinWords(texts, false);
}

/** 文首元信息的一个值：折成一行，再按 JSON 写成双引号字符串（合法的 YAML 标量）。 */
function yamlQuote(value: string): string {
  return JSON.stringify(oneLine(value));
}

const FRONT_MATTER_KEYS = [
  'title',
  'description',
  'source',
  'author',
  'published',
  'platform',
  'duration',
  'language',
  'translation',
] as const;

/** 文首元信息：`---` 之间每个字段一行，缺的不写；之后是正文里出现的说话人与章节表（`[mm:ss] 章名`）。 */
function frontMatterBlock(meta: FrontMatter, speakers: string[], chapters: TextChapter[]): string {
  const lines = ['---'];
  for (const key of FRONT_MATTER_KEYS) {
    const value = meta[key]?.trim();
    if (value) lines.push(`${key}: ${yamlQuote(value)}`);
  }
  if (speakers.length > 0) lines.push('speakers:', ...speakers.map((name) => `  - ${yamlQuote(name)}`));
  if (chapters.length > 0) lines.push('chapters:', ...chapters.map((c) => `  - ${yamlQuote(`[${transcriptStamp(c.start)}] ${c.title}`)}`));
  lines.push('---');
  return lines.join('\n');
}

/** 一段文稿：这一段开始了新的一章时带上那一章（小标题写在段前）。 */
interface TranscriptBlock {
  chapter: TextChapter | null;
  paragraph: Paragraph;
}

/** 段落配上章节：每章的小标题放在开始于它（及之后）的第一段前面；没有段落的章不写。 */
function transcriptBlocks(input: TextExportInput, segments: TextSegment[]): TranscriptBlock[] {
  const chapters = input.chapters ?? [];
  const paragraphs = paragraphsOf(
    segments,
    chapters.map((c) => c.start),
  );
  let current = -1;
  return paragraphs.map((paragraph) => {
    const index = chapters.findLastIndex((c) => c.start <= paragraph.start + 1e-6);
    const chapter = index >= 0 && index !== current ? chapters[index]! : null;
    if (index >= 0) current = index;
    return { chapter, paragraph };
  });
}

/** 文首列出的说话人：开着说话人时，正文里出现过的，按出现的先后。 */
function speakersOf(input: TextExportInput, blocks: TranscriptBlock[]): string[] {
  if (input.speakers === false) return [];
  return [...new Set(blocks.map((b) => b.paragraph.speaker).filter((s): s is string => s !== null))];
}

function writeMarkdown(input: TextExportInput, segments: TextSegment[]): { content: string; entries: number; end: number } {
  const blocks = transcriptBlocks(input, segments);
  const labels = input.speakers !== false;
  const out: string[] = [];
  if (input.frontMatter) out.push(frontMatterBlock(input.frontMatter, speakersOf(input, blocks), input.chapters ?? []));
  out.push(`# ${markdownText(input.meta.videoName)}`);
  for (const { chapter, paragraph: p } of blocks) {
    if (chapter) out.push(`## ${markdownText(oneLine(chapter.title))}${input.timestamps ? ` · ${transcriptStamp(chapter.start)}` : ''}`);
    const speaker = labels && p.speaker ? `**${markdownText(p.speaker)}:** ` : '';
    out.push(`${speaker}${markdownText(p.text)}${input.timestamps ? ` [${transcriptStamp(p.start)}]` : ''}`);
    if (p.translation) out.push(`> ${markdownText(p.translation)}`);
  }
  return { content: `${out.join('\n\n')}\n`, entries: blocks.length, end: Math.max(0, ...segments.map((s) => s.end)) };
}

function writeText(input: TextExportInput, segments: TextSegment[]): { content: string; entries: number; end: number; headings: number } {
  const blocks = transcriptBlocks(input, segments);
  const labels = input.speakers !== false;
  const out: string[] = [];
  let headings = 0;
  for (const { chapter, paragraph: p } of blocks) {
    if (chapter) {
      out.push(`— ${oneLine(chapter.title)} —`);
      headings++;
    }
    const speaker = labels && p.speaker ? `${p.speaker}: ` : '';
    const head = `${speaker}${p.text}${input.timestamps ? ` [${transcriptStamp(p.start)}]` : ''}`;
    out.push(p.translation ? `${head}\n${p.translation}` : head);
  }
  return { content: `${out.join('\n\n')}\n`, entries: blocks.length, end: Math.max(0, ...segments.map((s) => s.end)), headings };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** 写出一份字幕或文稿。 */
export function renderText(input: TextExportInput): TextExportOutput {
  const warnings: JobWarning[] = [];
  const maxWidth = input.maxCharsPerLine ?? EXPORT_MAX_CHARS_PER_LINE;
  const segments = segmentsOf(input, warnings).filter((s) => s.text.length > 0);
  let written: { content: string; entries: number; end: number; headings?: number };
  switch (input.format) {
    case 'srt':
      written = writeSrt(cuesOf(segments, maxWidth, warnings));
      break;
    case 'vtt':
      written = writeVtt(cuesOf(segments, maxWidth, warnings));
      break;
    case 'ass':
      written = writeAss(cuesOf(segments, maxWidth, warnings), input, warnings);
      break;
    case 'json':
      written = writeJson(input, segments);
      break;
    case 'md':
      written = writeMarkdown(input, segments);
      break;
    case 'txt':
      written = writeText(input, segments);
      break;
  }
  const text = segments.map((s) => s.text).join(' ');
  return {
    content: written.content,
    entries: written.entries,
    durationSec: written.end,
    words: (text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []).length,
    cjkCharacters: (text.match(/[一-鿿]/g) ?? []).length,
    headings: written.headings ?? 0,
    warnings,
    rangeSec: input.rangeDuration,
  };
}

// ---- 校验：按格式解析回来 ----

export interface TextCheck {
  ok: boolean;
  problems: string[];
  entries: number;
  durationSec: number;
}

const SRT_TIME = /^(\d{2,}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2,}):(\d{2}):(\d{2}),(\d{3})$/;
const VTT_TIME = /^(\d{2,}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2,}):(\d{2}):(\d{2})\.(\d{3})$/;
const ASS_TIME = /^Dialogue: \d+,(\d+):(\d{2}):(\d{2})\.(\d{2}),(\d+):(\d{2}):(\d{2})\.(\d{2}),/;

function seconds(m: RegExpExecArray, offset: number, fraction: number): number {
  return Number(m[offset]) * 3600 + Number(m[offset + 1]) * 60 + Number(m[offset + 2]) + Number(m[offset + 3]) / fraction;
}

/** 解析写出的文件：条数、时间单调、结束晚于开始、不超出范围。 */
export function checkText(
  format: TextFormat,
  content: string,
  expected: { entries: number; durationSec: number; /** 纯文本里章节小标题的块数（`TextExportOutput.headings`）。 */ headings?: number },
): TextCheck {
  const problems: string[] = [];
  const times: Array<[number, number]> = [];
  let entries = 0;
  if (format === 'srt' || format === 'vtt') {
    const lines = content.split('\n');
    if (format === 'vtt' && lines[0] !== 'WEBVTT') problems.push(RcExport.vttMissingHeader().text);
    const pattern = format === 'srt' ? SRT_TIME : VTT_TIME;
    const blocks = content.split(/\n\n+/).filter((b) => b.trim() && b.trim() !== 'WEBVTT');
    for (const block of blocks) {
      const rows = block.split('\n').filter(Boolean);
      const timeRow = format === 'srt' ? rows[1] : rows[0];
      if (format === 'srt' && !/^\d+$/.test(rows[0] ?? '')) problems.push(RcExport.cueMissingIndex({ n: entries + 1 }).text);
      const m = pattern.exec(timeRow ?? '');
      if (!m) {
        problems.push(RcExport.cueTimeLineUnparsable({ n: entries + 1 }).text);
        continue;
      }
      if (rows.length < (format === 'srt' ? 3 : 2)) problems.push(RcExport.cueNoText({ n: entries + 1 }).text);
      times.push([seconds(m, 1, 1000), seconds(m, 5, 1000)]);
      entries++;
    }
  } else if (format === 'ass') {
    if (!content.startsWith('[Script Info]') || !content.includes('[Events]')) problems.push(RcExport.assMissingSections().text);
    for (const line of content.split('\n')) {
      if (!line.startsWith('Dialogue:')) continue;
      const m = ASS_TIME.exec(line);
      if (!m) {
        problems.push(RcExport.cueTimeUnparsable({ n: entries + 1 }).text);
        continue;
      }
      times.push([seconds(m, 1, 100), seconds(m, 5, 100)]);
      entries++;
    }
  } else if (format === 'json') {
    try {
      const parsed = JSON.parse(content) as {
        segments?: Array<{ start: number; end: number; words?: Array<{ start: number; end: number }> }>;
      };
      for (const s of parsed.segments ?? []) {
        times.push([s.start, s.end]);
        for (const w of s.words ?? [])
          if (!(w.end >= w.start && w.start >= s.start - 0.001 && w.end <= s.end + 0.001)) problems.push(RcExport.wordTimeOutsideSentence().text);
        entries++;
      }
    } catch {
      problems.push(RcExport.invalidJson().text);
    }
  } else {
    // 段落之外的块：文首元信息、标题、章节小标题与译文（Markdown，正文里的 `#`、`>` 都转义过，按开头认得出）；
    // 纯文本的章节小标题按写出的块数扣掉——正文本身可以长得和小标题一样（「— 题外话 —」）。
    const blocks = content.split(/\n\n+/).filter((b) => b.trim());
    entries =
      format === 'md'
        ? blocks.filter((b) => !b.startsWith('---\n') && !b.startsWith('# ') && !b.startsWith('## ') && !b.startsWith('> ')).length
        : blocks.length - (expected.headings ?? 0);
  }
  for (let i = 0; i < times.length; i++) {
    const [a, b] = times[i]!;
    if (!(b > a)) problems.push(RcExport.cueEndNotAfterStart({ n: i + 1 }).text);
    if (i > 0 && format !== 'json' && a < times[i - 1]![1] - 1e-9) problems.push(RcExport.cueOverlapsPrevious({ n: i + 1 }).text);
  }
  const durationSec = Math.max(0, ...times.map(([, b]) => b));
  if (durationSec > expected.durationSec + 0.001)
    problems.push(RcExport.lastCueBeyondRange({ end: durationSec, range: expected.durationSec }).text);
  if (entries !== expected.entries) problems.push(RcExport.entryCountMismatch({ parsed: entries, written: expected.entries }).text);
  if (entries === 0) problems.push(RcExport.noContent().text);
  return { ok: problems.length === 0, problems, entries, durationSec };
}
