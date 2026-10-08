import { defineMessages, type EditOperation, type Sequence } from '@baocut/protocol';
import { trackFree } from './editor-ops.ts';
import type { Cue as FileCue } from './subtitles.ts';
import { zhHans } from './cue-edit.zh-Hans.ts';
import { zhHant } from './cue-edit.zh-Hant.ts';
import { ja } from './cue-edit.ja.ts';
import { ko } from './cue-edit.ko.ts';
import { es } from './cue-edit.es.ts';
import { fr } from './cue-edit.fr.ts';
import { de } from './cue-edit.de.ts';
import { nl } from './cue-edit.nl.ts';
import { ptBR } from './cue-edit.pt-BR.ts';
import { it } from './cue-edit.it.ts';
import { ru } from './cue-edit.ru.ts';
import { pl } from './cue-edit.pl.ts';
import { tr } from './cue-edit.tr.ts';
import { vi } from './cue-edit.vi.ts';

/** 字幕写入的文案（英文是键与类型的来源，译文在 `cue-edit.zh-Hans.ts`）：新建字幕轨的名字取建轨那一刻的界面语言。 */
const en = {
  subtitleTrack: 'Subtitles',
};
export type CueEditMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 字幕面板的写入（照原型 `model-cueops.js` 与旧版 `cue_edit.rs`）：一次动作改字幕文档的正文、写一个新版本。
 * 正文是 `baocut.caption/1`：整数刻度的时间，句子上别的字段（说话人、段首、所属译文单元……）原样带走；
 * 文字一改，词级时间（`words`）就对不上了，扔掉。
 */

type Json = Record<string, unknown>;

export const CAPTION_SCHEMA = 'baocut.caption/1';

/** 拆开的两边各不短于这么多秒（太短的句子对半分）。 */
const MIN_PIECE = 0.3;
const CJK = /[　-〿぀-ヿ㐀-鿿가-힯豈-﫿＀-￯]/;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const ticksOf = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** 列表里的一句：按开始时刻排好，时间是文档时钟上的秒。 */
export interface ListCue {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface CueList {
  clock: 'source-asset' | 'sequence';
  cues: ListCue[];
}

/** 正文里的句子，没有 ID 的补上（按原来的下标，与 `readCaptions` 的口径一致），之后的写入都按 ID 找。 */
function rawCues(body: Json): Json[] {
  const cues = Array.isArray(body.cues) ? body.cues : [];
  return cues.filter(isObject).map((cue, index) => (typeof cue.id === 'string' ? cue : { ...cue, id: `cue-${index}` }));
}

function timescaleOf(body: Json): number {
  return ticksOf(body.timescale) || 1_000_000;
}

export function isCaptionBody(body: unknown): body is Json {
  return isObject(body) && body.schema === CAPTION_SCHEMA && Array.isArray(body.cues);
}

/** 列表看的样子：按开始时刻排序（同一刻按结束）。不是 `baocut.caption/1` 时返回 null。 */
export function listCues(body: unknown): CueList | null {
  if (!isCaptionBody(body)) return null;
  const scale = timescaleOf(body);
  const cues = rawCues(body)
    .map((cue): ListCue => {
      const start = ticksOf(cue.start) / scale;
      return {
        id: cue.id as string,
        start,
        end: Math.max(start, ticksOf(cue.end) / scale),
        text: typeof cue.text === 'string' ? cue.text : '',
        ...(typeof cue.speaker === 'string' ? { speaker: cue.speaker } : {}),
      };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  return { clock: body.clock === 'sequence' ? 'sequence' : 'source-asset', cues };
}

function withCues(body: Json, cues: Json[]): Json {
  return { ...body, cues };
}

function retext(cue: Json, text: string): Json {
  if (cue.text === text) return cue;
  const { words: _words, ...rest } = cue;
  return { ...rest, text };
}

/** 改几句的文字（`id → 新文字`）。返回新正文与真正改了的句数。 */
export function setCueTexts(body: Json, texts: ReadonlyMap<string, string>): { body: Json; changed: number } {
  let changed = 0;
  const cues = rawCues(body).map((cue) => {
    const text = texts.get(cue.id as string);
    if (text === undefined || text === cue.text) return cue;
    changed++;
    return retext(cue, text);
  });
  return { body: changed ? withCues(body, cues) : body, changed };
}

/** 两段文字相接时中间放什么：中日韩文（或本来就带空白）直接相接，其余补一个空格。 */
export function joiner(a: string, b: string): string {
  if (!a || !b) return '';
  const last = a[a.length - 1]!;
  const first = b[0]!;
  return CJK.test(last) || CJK.test(first) || /\s/.test(last) || /\s/.test(first) ? '' : ' ';
}

/** 在 `at` 处切文字；任一边切空就不算拆（光标在两端）。 */
export function cutText(text: string, at: number): { left: string; right: string } | null {
  const index = Math.max(0, Math.min(text.length, Math.trunc(at)));
  const left = text.slice(0, index).trim();
  const right = text.slice(index).trim();
  return left && right ? { left, right } : null;
}

/** 拆分点（刻度）：按两边的字数比例分，各不短于 0.3 秒，落在 0.01 秒上；太短的句子取中点。 */
export function splitTicks(start: number, end: number, leftLength: number, rightLength: number, timescale: number): number {
  const duration = end - start;
  const min = MIN_PIECE * timescale;
  const raw =
    duration <= min * 2
      ? start + duration / 2
      : Math.min(end - min, Math.max(start + min, start + (duration * leftLength) / (leftLength + rightLength)));
  const step = timescale / 100;
  return Math.min(end, Math.max(start, Math.round(Math.round(raw / step) * step)));
}

function freshId(cues: readonly Json[], base: string): string {
  const taken = new Set(cues.map((cue) => cue.id));
  let n = 1;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** 在光标处把一句拆成两句。`text` 是编辑框里这一刻的文字（没提交也算）。光标在两端时返回 null。 */
export function splitCue(body: Json, id: string, text: string, at: number): { body: Json; id: string } | null {
  const cues = rawCues(body);
  const index = cues.findIndex((cue) => cue.id === id);
  const cut = cutText(text, at);
  if (index < 0 || !cut) return null;
  const cue = cues[index]!;
  const start = ticksOf(cue.start);
  const end = Math.max(start, ticksOf(cue.end));
  const time = splitTicks(start, end, cut.left.length, cut.right.length, timescaleOf(body));
  const { words: _words, paragraphStart: _paragraph, ...rest } = cue;
  const nextId = freshId(cues, id);
  const left = { ...retext(cue, cut.left), end: time };
  const right = { ...rest, id: nextId, text: cut.right, start: time };
  return { body: withCues(body, [...cues.slice(0, index), left, right, ...cues.slice(index + 1)]), id: nextId };
}

export type MergeRefusal = 'edge' | 'speaker';

/**
 * 把一句并进相邻那句（`direction` −1 上 / +1 下，按列表次序）：同说话人才并，时间接上。
 * 返回并后那句的 ID 与接缝在新文字里的位置。
 */
export function mergeCue(
  body: Json,
  id: string,
  text: string | null,
  direction: -1 | 1,
): { body: Json; id: string; caret: number } | { refused: MergeRefusal } {
  const list = listCues(body)?.cues ?? [];
  const at = list.findIndex((cue) => cue.id === id);
  const neighbor = list[at + direction];
  if (at < 0 || !neighbor) return { refused: 'edge' };
  const me = list[at]!;
  if ((me.speaker ?? null) !== (neighbor.speaker ?? null)) return { refused: 'speaker' };
  const cues = rawCues(body);
  const mine = cues.find((cue) => cue.id === id)!;
  const theirs = cues.find((cue) => cue.id === neighbor.id)!;
  const [first, second]: [Json, Json] =
    direction < 0 ? [theirs, { ...mine, text: text ?? mine.text }] : [{ ...mine, text: text ?? mine.text }, theirs];
  const a = typeof first.text === 'string' ? first.text : '';
  const b = typeof second.text === 'string' ? second.text : '';
  const seam = joiner(a, b);
  const { words: _words, ...rest } = first;
  const merged: Json = {
    ...rest,
    text: a + seam + b,
    start: Math.min(ticksOf(first.start), ticksOf(second.start)),
    end: Math.max(ticksOf(first.end), ticksOf(second.end)),
  };
  const next = cues.flatMap((cue) => (cue.id === first.id ? [merged] : cue.id === second.id ? [] : [cue]));
  return { body: withCues(body, next), id: merged.id as string, caret: a.length + seam.length };
}

export type ReadingLevel = 'none' | 'ok' | 'warn' | 'bad';

/** 阅读速度（每秒字数，不数空白）：中日韩泰超过 9 偏快、13 太快，其余 17 与 21。 */
export function readingSpeed(text: string, seconds: number, language: string | undefined): { value: number; level: ReadingLevel } {
  const count = Array.from(text).filter((char) => !/\s/u.test(char)).length;
  const raw = count / Math.max(0.1, seconds || 0);
  const [warn, bad] = /^(zh|ja|ko|th)(?:[-_]|$)/i.test(language ?? '') ? [9, 13] : [17, 21];
  return { value: Math.round(raw * 10) / 10, level: !count ? 'none' : raw > bad ? 'bad' : raw > warn ? 'warn' : 'ok' };
}

/** 文档没写语言时按字猜：假名 → ja，谚文 → ko，汉字占多 → zh；猜不出返回 undefined。 */
export function guessLanguage(text: string): string | undefined {
  const chars = Array.from(text).filter((char) => !/[\s\p{P}\p{N}]/u.test(char));
  if (!chars.length) return undefined;
  const count = (re: RegExp) => chars.filter((char) => re.test(char)).length;
  if (count(/[぀-ヿ]/) > chars.length * 0.1) return 'ja';
  if (count(/[가-힯]/) > chars.length * 0.3) return 'ko';
  if (count(/[㐀-鿿豈-﫿]/) > chars.length * 0.3) return 'zh';
  return undefined;
}

/** 字幕文件 → 字幕文档的正文：序列时钟、毫秒刻度。 */
export function captionBodyOf(cues: readonly FileCue[]): Json {
  return {
    schema: CAPTION_SCHEMA,
    clock: 'sequence',
    timescale: 1000,
    cues: cues.map((cue) => ({
      id: `c${cue.index}`,
      start: Math.round(cue.start * 1000),
      end: Math.round(cue.end * 1000),
      text: cue.text,
    })),
  };
}

const IMPORTED = 'imported-caption';
const NEW_TRACK = 'new-subtitle-track';

/**
 * 导入一份字幕文件的事务：写文档、放一个字幕实例（从 0 到最后一句结束）。字幕轨里有空着、没锁的就放进去
 * （从下往上找），没有就新建一条。
 */
export function importCaptionOperations(
  sequence: Sequence,
  cues: readonly FileCue[],
  name: string,
  language: string | undefined,
): EditOperation[] {
  const perSecond = sequence.fps.num / sequence.fps.den;
  const last = Math.max(0, ...cues.map((cue) => cue.end));
  const span = { fromFrame: 0, durationFrames: Math.max(1, Math.ceil(last * perSecond - 1e-6)) };
  const free = sequence.tracks
    .filter((track) => track.kind === 'subtitle' && !track.locked)
    .sort((a, b) => a.order - b.order)
    .find((track) => trackFree(sequence, track.id, span.fromFrame, span.fromFrame + span.durationFrames));
  const operations: EditOperation[] = [];
  if (!free) operations.push({ type: 'addTrack', sequenceId: sequence.id, kind: 'subtitle', ref: NEW_TRACK, name: M.subtitleTrack });
  operations.push({
    type: 'putDocument',
    ref: IMPORTED,
    kind: 'caption',
    name,
    ...(language ? { language } : {}),
    body: captionBodyOf(cues),
    summary: { cueCount: cues.length },
  });
  operations.push({
    type: 'insertItems',
    sequenceId: sequence.id,
    items: [{ type: 'caption', name, span, documentRef: IMPORTED, ...(free ? { trackId: free.id } : { trackRef: NEW_TRACK }) }],
  });
  return operations;
}
