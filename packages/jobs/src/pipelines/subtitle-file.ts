import type { Localized } from '@baocut/protocol';
import { JobsSubtitleFile } from '@baocut/protocol/messages/jobs/subtitle-file.ts';
import { LocalizedError, type JobText } from '../job-text.ts';
import { joinWords } from './translation-document.ts';

/**
 * 字幕文件（SRT、WebVTT）的严格读写，供字幕文件的翻译（`translate-subtitles`，架构设计 §7.9）用：时间码原样保留，
 * 只换文本，不合并、不拆分字幕条。与播放器叠加显示用的宽松解析（`packages/ui` 的 subtitles.ts：排序、丢掉空条与坏条）
 * 不同，这里读不准的文件一律拒绝并指出行号，不猜。
 *
 * 认的写法：UTF-8（可带 BOM）、UTF-16（带 BOM）、不是合法 UTF-8 时按 GB18030；CRLF、CR 换行；多行文本；空文本的条；
 * SRT 的序号行可以省略；VTT 的头部、cue 标识、cue settings 与 NOTE、STYLE、REGION 块。拒绝：有文本却没有时间行的块、
 * 文本里出现时间行（通常是两条之间少了空行）、毫秒不是三位、分秒越界、结束早于开始、一条也没有、超过大小与条数上限。
 *
 * 行内标记（SRT 的 `<i>`、`<font>`、`{\an8}`，VTT 的 `<c.x>`、`<v 说话人>`、时间戳标签与字符实体）送模型前去掉，
 * 输出的文本也不带；调用方记下有多少条去了标记。
 */

export type SubtitleFormat = 'srt' | 'vtt';

/** 文件大小的上限（字节）。 */
export const MAX_SUBTITLE_BYTES = 4 * 1024 * 1024;
/** 字幕条数的上限。 */
export const MAX_SUBTITLE_CUES = 10_000;
/** 一条字幕文本的字数上限。 */
export const MAX_CUE_CHARS = 1000;

export interface SubtitleCue {
  /** SRT 的序号行、VTT 的 cue 标识；没有时 null。 */
  id: string | null;
  /** 原样的时间行（去掉首尾空白；VTT 含 cue settings）。 */
  timing: string;
  startMs: number;
  endMs: number;
  /** 结束时间之后的部分（VTT 的 cue settings、SRT 偶见的坐标）；没有时空串。 */
  settings: string;
  /** 原样的文本行（可以没有）。 */
  lines: string[];
  /** 时间行在文件里的行号（从 1 开始）。 */
  line: number;
}

export interface SubtitleDocument {
  format: SubtitleFormat;
  /** VTT 的头部块（`WEBVTT` 行与之后的头部行）；SRT 为 null。 */
  header: string | null;
  cues: SubtitleCue[];
  /** VTT 的 NOTE、STYLE、REGION 块：原样，`before` 是它之后那一条字幕的下标（在全部字幕之后时等于条数）。 */
  blocks: Array<{ before: number; text: string }>;
}

/** 读不准的字幕文件。`code` 是命令与协议规范 §11.3 的错误码；`message` 给目录文字时引用记在 `messageRef`。 */
export class SubtitleFileError extends LocalizedError {
  readonly code: 'SUBTITLE_FILE_INVALID' | 'SUBTITLE_FILE_TOO_LARGE';
  readonly details: Record<string, unknown>;

  constructor(code: SubtitleFileError['code'], message: JobText, details: Record<string, unknown>) {
    super(message);
    this.name = 'SubtitleFileError';
    this.code = code;
    this.details = details;
  }
}

/** 按扩展名认格式；不是 .srt、.vtt 时 null。 */
export function subtitleFormatOf(file: string): SubtitleFormat | null {
  const ext = /\.([^./\\]+)$/.exec(file)?.[1]?.toLowerCase();
  return ext === 'srt' || ext === 'vtt' ? ext : null;
}

/** 字节转文字：UTF-16 的 BOM 按 UTF-16；否则 UTF-8（可带 BOM），不是合法 UTF-8 时按 GB18030。 */
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030').decode(bytes);
  }
}

/** 读一个字幕文件的字节：检查大小、解码、严格解析。 */
export function readSubtitleBytes(bytes: Uint8Array, format: SubtitleFormat): SubtitleDocument {
  if (bytes.byteLength > MAX_SUBTITLE_BYTES) {
    throw new SubtitleFileError('SUBTITLE_FILE_TOO_LARGE', JobsSubtitleFile.tooLarge({ bytes: bytes.byteLength, limit: MAX_SUBTITLE_BYTES }), {
      bytes: bytes.byteLength,
      limit: MAX_SUBTITLE_BYTES,
    });
  }
  return parseSubtitles(decodeSubtitleBytes(bytes), format);
}

/**
 * 字幕文件去掉时间码与行内标记后的正文（工具的 Space 条目输入当文字用，架构设计 §7.9）：每条一行，空的条不要。
 * 读不准时同 `readSubtitleBytes` 抛 `SubtitleFileError`。
 */
export function subtitleText(bytes: Uint8Array, format: SubtitleFormat): string {
  const document = readSubtitleBytes(bytes, format);
  return document.cues
    .map((cue) => cueText(plainLines(cue, format).lines))
    .filter((text) => text !== '')
    .join('\n');
}

const SRT_TIME = String.raw`(\d{1,3}):(\d{2}):(\d{2})[,.](\d{3})`;
const VTT_TIME = String.raw`(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})`;
const SRT_TIMING = new RegExp(String.raw`^${SRT_TIME}[ \t]*-->[ \t]*${SRT_TIME}(?:[ \t]+(.*))?$`);
const VTT_TIMING = new RegExp(String.raw`^${VTT_TIME}[ \t]+-->[ \t]+${VTT_TIME}(?:[ \t]+(.*))?$`);

interface Block {
  lines: string[];
  /** 第一行的行号（从 1 开始）。 */
  line: number;
}

/** 严格解析：读不准时抛 `SubtitleFileError`。 */
export function parseSubtitles(source: string, format: SubtitleFormat): SubtitleDocument {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (text.includes('\u0000')) throw invalidAt(1, JobsSubtitleFile.nul());
  const blocks = splitBlocks(text);
  const cues: SubtitleCue[] = [];
  const extras: SubtitleDocument['blocks'] = [];
  let header: string | null = null;
  let rest = blocks;
  if (format === 'vtt') {
    const first = blocks[0];
    if (!first || !/^WEBVTT(?:[ \t].*)?$/.test(first.lines[0]!) || first.line !== 1) {
      throw invalidAt(first?.line ?? 1, JobsSubtitleFile.vttHeader());
    }
    first.lines.forEach((l, i) => {
      if (l.includes('-->')) throw invalidAt(first.line + i, JobsSubtitleFile.vttHeaderBlank());
    });
    header = first.lines.join('\n');
    rest = blocks.slice(1);
  }
  for (const block of rest) {
    if (format === 'vtt' && /^(?:NOTE(?:[ \t].*)?|STYLE|REGION)$/.test(block.lines[0]!.trimEnd())) {
      extras.push({ before: cues.length, text: block.lines.join('\n') });
      continue;
    }
    cues.push(parseCue(block, format));
    if (cues.length > MAX_SUBTITLE_CUES) {
      throw new SubtitleFileError('SUBTITLE_FILE_TOO_LARGE', JobsSubtitleFile.tooManyCues({ limit: MAX_SUBTITLE_CUES }), { limit: MAX_SUBTITLE_CUES });
    }
  }
  if (cues.length === 0) throw invalidAt(1, JobsSubtitleFile.empty());
  return { format, header, cues, blocks: extras };
}

/** 以空行（只有空白的行）分块。 */
function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') {
      current = null;
      return;
    }
    if (!current) {
      current = { lines: [], line: i + 1 };
      blocks.push(current);
    }
    current.lines.push(line);
  });
  return blocks;
}

function parseCue(block: Block, format: SubtitleFormat): SubtitleCue {
  const pattern = format === 'srt' ? SRT_TIMING : VTT_TIMING;
  const timingAt = block.lines.findIndex((l) => l.includes('-->'));
  if (timingAt === -1) throw invalidAt(block.line, JobsSubtitleFile.noTiming());
  if (timingAt > 1) throw invalidAt(block.line, JobsSubtitleFile.tooManyIdLines());
  const id = timingAt === 1 ? block.lines[0]!.trim() : null;
  if (format === 'srt' && id !== null && !/^\d+$/.test(id)) throw invalidAt(block.line, JobsSubtitleFile.srtIndex({ id }));
  const lineNo = block.line + timingAt;
  const timing = block.lines[timingAt]!.trim();
  const match = pattern.exec(timing);
  if (!match) throw invalidAt(lineNo, JobsSubtitleFile.badTiming({ timing }));
  const startMs = toMs(match.slice(1, 5), lineNo);
  const endMs = toMs(match.slice(5, 9), lineNo);
  if (endMs < startMs) throw invalidAt(lineNo, JobsSubtitleFile.endBeforeStart());
  const lines = block.lines.slice(timingAt + 1);
  lines.forEach((l, i) => {
    if (l.includes('-->')) throw invalidAt(lineNo + 1 + i, JobsSubtitleFile.timingInText());
  });
  if (lines.join('\n').length > MAX_CUE_CHARS) throw invalidAt(lineNo, JobsSubtitleFile.cueTooLong({ max: MAX_CUE_CHARS }));
  return { id, timing, startMs, endMs, settings: (match[9] ?? '').trim(), lines, line: lineNo };
}

function toMs([h, m, s, ms]: Array<string | undefined>, line: number): number {
  const minutes = Number(m);
  const seconds = Number(s);
  if (minutes >= 60 || seconds >= 60) throw invalidAt(line, JobsSubtitleFile.minuteSecondRange());
  return ((Number(h ?? 0) * 60 + minutes) * 60 + seconds) * 1000 + Number(ms);
}

/** `details.problem` 是按当前语言生成的文字（`details` 没有引用字段），整句的引用在错误的 `messageRef` 里。 */
function invalidAt(line: number, problem: Localized): SubtitleFileError {
  return new SubtitleFileError('SUBTITLE_FILE_INVALID', JobsSubtitleFile.invalidAt({ line, problem }), { line, problem: problem.text });
}

const VTT_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', nbsp: ' ', lrm: '', rlm: '' };

/**
 * 一条字幕去掉行内标记后的各行（去掉首尾空白与空行）。`marked`：原文带标记。
 * VTT 里 `<…>` 都是标记（字面的 `<` 要写成 `&lt;`）；SRT 里只认以字母或 `/` 开头的标签与 `{\…}`。
 */
export function plainLines(cue: SubtitleCue, format: SubtitleFormat): { lines: string[]; marked: boolean } {
  const tags = format === 'vtt' ? VTT_TAG : SRT_TAG;
  let marked = false;
  const lines = cue.lines
    .map((line) => {
      if (OVERRIDE.test(line) || tags.test(line)) marked = true;
      let plain = line.replace(new RegExp(OVERRIDE.source, 'g'), '').replace(new RegExp(tags.source, 'g'), '');
      if (format === 'vtt') {
        plain = plain
          .replace(/&(amp|lt|gt|nbsp|lrm|rlm);/g, (_, name: string) => VTT_ENTITIES[name]!)
          .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
          .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
      }
      return plain.trim();
    })
    .filter((line) => line !== '');
  return { lines, marked };
}

const OVERRIDE = /\{\\[^}]*\}/;
const VTT_TAG = /<[^>]*>/;
const SRT_TAG = /<\/?[A-Za-z][^<>]*>/;

/** 一条字幕送模型的文本：去掉标记的各行接成一句（拉丁文字之间补空格，中文不加）。空串表示这条不用翻译。 */
export function cueText(lines: string[]): string {
  return joinWords(lines);
}

/** 译文整理成字幕的文本行：按换行拆开、去掉首尾空白与空行，`-->` 换成箭头（不能出现在字幕文本里）。 */
export function translationLines(text: string): string[] {
  return text
    .split(/\r\n?|\n/)
    .map((l) => l.replace(/-->/g, '→').trim())
    .filter((l) => l !== '');
}

export interface RenderedSubtitles {
  text: string;
  /** VTT 转 SRT 时丢掉的 cue settings 条数与 NOTE、STYLE、REGION 块数。 */
  droppedSettings: number;
  droppedBlocks: number;
}

/**
 * 写出字幕文件（UTF-8、LF、不带 BOM）：每条的时间码不变，文本换成 `texts[i]` 的各行。
 * 同一格式时序号或标识、时间行（含 cue settings）原样照抄，VTT 的头部与 NOTE、STYLE、REGION 块留在原处；
 * 换格式时时间码按毫秒重写（SRT 用 `,`，VTT 用 `.`、小时补足两位）。VTT 转 SRT：标识都是正整数时用作序号，否则按顺序编号；
 * cue settings 与 NOTE 等块 SRT 放不下，丢掉并计数。
 */
export function renderSubtitles(source: SubtitleDocument, texts: string[][], format: SubtitleFormat): RenderedSubtitles {
  const same = format === source.format;
  const out: string[] = [];
  let droppedSettings = 0;
  let droppedBlocks = 0;
  const numericIds = source.cues.every((c) => c.id !== null && /^[1-9]\d*$/.test(c.id));
  const escape = (l: string) => (format === 'vtt' ? l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : l);
  if (format === 'vtt') out.push(same ? source.header! : 'WEBVTT');
  const pushBlocks = (before: number) => {
    for (const block of source.blocks) {
      if (block.before !== before) continue;
      if (format === 'vtt') out.push(block.text);
      else droppedBlocks++;
    }
  };
  source.cues.forEach((cue, i) => {
    pushBlocks(i);
    const lines: string[] = [];
    if (format === 'srt') lines.push(same ? (cue.id ?? String(i + 1)) : numericIds ? cue.id! : String(i + 1));
    else if (cue.id !== null) lines.push(cue.id);
    if (same) {
      lines.push(cue.timing);
    } else {
      if (format === 'srt' && cue.settings !== '') droppedSettings++;
      lines.push(`${clock(cue.startMs, format)} --> ${clock(cue.endMs, format)}`);
    }
    lines.push(...texts[i]!.map(escape));
    out.push(lines.join('\n'));
  });
  pushBlocks(source.cues.length);
  return { text: `${out.join('\n\n')}\n`, droppedSettings, droppedBlocks };
}

/** `hh:mm:ss,ttt`（SRT）或 `hh:mm:ss.ttt`（VTT）。 */
export function clock(ms: number, format: SubtitleFormat): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}${format === 'srt' ? ',' : '.'}${pad(ms % 1000, 3)}`;
}
