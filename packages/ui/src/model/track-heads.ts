import type { CaptionItem, DocumentRecord, Id, Sequence, Track } from '@baocut/protocol';
import { captionKind } from './caption-tracks.ts';

/**
 * 时间线行头的语言标签（原型 model-timeline.js 的 `langTag` / `headTags`，2026-10-08）。行头只有 144px，「字幕 · 简体中文」
 * 这类全名在别的界面语言里更长，放不下；字幕行与配音行写 ZH、EN、PT-BR 这样的短标签，任何界面语言下都一样宽。
 * 原文与译文靠行头图标分开，全名与原文 / 译文进悬停说明。没有语言的行照旧写全名。
 */

/** 语言标签：去掉首尾空白、下划线换成连字符、大写（`pt_BR` → `PT-BR`）。没有语言时是空串。 */
export function languageTag(language: string | null | undefined): string {
  return (language ?? '').trim().replace(/_/g, '-').toUpperCase();
}

/** 一行的语言：字幕行或配音行，别的行不写标签。 */
export interface HeadLanguage {
  trackId: Id;
  group: 'subtitle' | 'dub';
  language: string | null;
}

/** 各行的标签。同一类（字幕 / 配音）里同一个标签不止一行时按行的先后编号（「EN 1」「EN 2」），没有语言的行不在里面。 */
export function headTags(rows: readonly HeadLanguage[]): Map<Id, string> {
  const count = new Map<string, number>();
  for (const row of rows) {
    const tag = languageTag(row.language);
    if (tag) count.set(`${row.group}:${tag}`, (count.get(`${row.group}:${tag}`) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const out = new Map<Id, string>();
  for (const row of rows) {
    const tag = languageTag(row.language);
    if (!tag) continue;
    const key = `${row.group}:${tag}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    out.set(row.trackId, (count.get(key) ?? 0) > 1 ? `${tag} ${n}` : tag);
  }
  return out;
}

/**
 * 字幕行是哪门语言、原文还是译文：看这条轨上最早的字幕实例引用的字幕文档（与字幕轨条、预览同一个判法）。字幕文档没写语言时
 * 取它派生自的文档（转写或译文）的语言。轨上没有字幕实例时 null。
 */
export function subtitleTrackLanguage(
  sequence: Sequence,
  track: Track,
  documents: Record<Id, DocumentRecord>,
): { language: string | null; kind: 'original' | 'translation' } | null {
  const first = sequence.items
    .filter((item): item is CaptionItem => item.trackId === track.id && item.type === 'caption')
    .sort((a, b) => a.span.fromFrame - b.span.fromFrame)[0];
  if (!first) return null;
  const record = documents[first.documentId];
  const parent = record?.sourceDocumentId ? documents[record.sourceDocumentId] : undefined;
  return { language: record?.language ?? parent?.language ?? null, kind: captionKind(first.documentId, documents) };
}
