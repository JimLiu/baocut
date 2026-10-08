/**
 * 字幕文件的解析（产品设计 §11.1 的 0.3：播放器叠加显示字幕文件）。只读：
 * SRT、WebVTT、ASS / SSA 解析成同一种句子列表，时间以秒计。样式与位置不保留，
 * 只留文字和换行；看不懂的块跳过，不让整份文件失败。
 */

export type SubtitleFormat = 'srt' | 'vtt' | 'ass';

export interface Cue {
  /** 排序后的序号，从 1 开始。 */
  index: number;
  start: number;
  end: number;
  text: string;
}

export function subtitleFormatOf(fileName: string): SubtitleFormat | null {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'srt') return 'srt';
  if (ext === 'vtt') return 'vtt';
  if (ext === 'ass' || ext === 'ssa') return 'ass';
  return null;
}

/**
 * 字幕文件的字节转文字。UTF-8 优先；不是合法 UTF-8 时按 GB18030（兼容 GBK，中文字幕常见）；
 * 有 UTF-16 的 BOM 时按 UTF-16。
 */
export function decodeSubtitleText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030').decode(bytes);
  }
}

export function parseSubtitles(source: string, format: SubtitleFormat): Cue[] {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const raw = format === 'ass' ? parseAss(text) : parseBlocks(text, format);
  return raw
    .filter((cue) => cue.text && cue.end > cue.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((cue, i) => ({ ...cue, index: i + 1 }));
}

type RawCue = Omit<Cue, 'index'>;

/** `01:02:03,456`、`02:03.4`、`1:02:03.45` 都认；毫秒位数不足按小数补齐。 */
const TIME = /(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?/;
const TIMING = new RegExp(`^\\s*${TIME.source}\\s*-->\\s*${TIME.source}`);

function seconds(h: string | undefined, m: string, s: string, frac: string | undefined): number {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + (frac ? Number(`0.${frac}`) : 0);
}

function parseBlocks(text: string, format: 'srt' | 'vtt'): RawCue[] {
  const cues: RawCue[] = [];
  for (const block of text.split(/\n[ \t]*\n/)) {
    const lines = block.replace(/^\s*\n/, '').split('\n');
    const at = lines.findIndex((line) => TIMING.test(line));
    // VTT 的文件头、NOTE、STYLE、REGION 块没有时间行，自然跳过。
    if (at < 0 || at > 1) continue;
    const m = TIMING.exec(lines[at]!)!;
    cues.push({
      start: seconds(m[1], m[2]!, m[3]!, m[4]),
      end: seconds(m[5], m[6]!, m[7]!, m[8]),
      text: cleanMarkup(lines.slice(at + 1).join('\n'), format),
    });
  }
  return cues;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', nbsp: ' ', quot: '"', apos: "'", lrm: '‎', rlm: '‏' };

function cleanMarkup(text: string, format: 'srt' | 'vtt'): string {
  let out = text
    .replace(/<[^>\n]*>/g, '')
    // 有些 SRT 带着 ASS 的定位标记，例如 `{\an8}`。
    .replace(/\{\\[^}]*\}/g, '');
  if (format === 'vtt') out = out.replace(/&(amp|lt|gt|nbsp|quot|apos|lrm|rlm);/g, (_, name: string) => ENTITIES[name]!);
  return out
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/** ASS 的默认列（没有 Format 行时）：第一列是 Layer（ASS）或 Marked（SSA），最后一列是文字。 */
const ASS_DEFAULT_FORMAT = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
const ASS_TIME = /^(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/;

function parseAss(text: string): RawCue[] {
  const cues: RawCue[] = [];
  let inEvents = false;
  let format = ASS_DEFAULT_FORMAT;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      inEvents = trimmed.toLowerCase() === '[events]';
      continue;
    }
    if (!inEvents) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    const kind = trimmed.slice(0, colon).toLowerCase();
    const body = trimmed.slice(colon + 1).trim();
    if (kind === 'format') {
      format = body.split(',').map((f) => f.trim().toLowerCase());
      continue;
    }
    if (kind !== 'dialogue') continue;
    // 文字是最后一列，里面可以有逗号：只切出前面的列。
    const fields: string[] = [];
    let rest = body;
    for (let i = 0; i < format.length - 1; i++) {
      const comma = rest.indexOf(',');
      if (comma < 0) break;
      fields.push(rest.slice(0, comma).trim());
      rest = rest.slice(comma + 1);
    }
    fields.push(rest);
    if (fields.length !== format.length) continue;
    const start = ASS_TIME.exec(fields[format.indexOf('start')] ?? '');
    const end = ASS_TIME.exec(fields[format.indexOf('end')] ?? '');
    if (!start || !end) continue;
    cues.push({
      start: seconds(start[1], start[2]!, start[3]!, start[4]),
      end: seconds(end[1], end[2]!, end[3]!, end[4]),
      text: cleanAss(fields[format.indexOf('text')] ?? ''),
    });
  }
  return cues;
}

function cleanAss(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/**
 * `time` 时正在显示的句子（可以有几句重叠），按开始时间排。
 * 句子已按开始时间排好：只看开始不晚于 `time` 的那一段。
 */
export function activeCues(cues: readonly Cue[], time: number): Cue[] {
  const active: Cue[] = [];
  for (const cue of cues) {
    if (cue.start > time) break;
    if (time < cue.end) active.push(cue);
  }
  return active;
}

/** 列表该停在哪一句（序号）：正在显示的那句；两句之间取下一句；过了最后一句取最后一句。没有句子时为 null。 */
export function nearIndex(cues: readonly Cue[], time: number): number | null {
  if (!cues.length) return null;
  let next = 0;
  while (next < cues.length && cues[next]!.start <= time) next++;
  const current = cues[next - 1];
  if (current && time < current.end) return current.index;
  return cues[Math.min(next, cues.length - 1)]!.index;
}

/** 字幕列表里点一句时定位到哪里：句首稍后一点，避开与上一句结束重合的那一刻。 */
export function seekTimeOf(cue: Cue): number {
  return Math.min(cue.start + 0.001, cue.end);
}
