import { defineMessages, type CaptionItem, type DocumentRecord, type EditOperation, type Id, type Sequence } from '@baocut/protocol';
import { zhHans } from './caption-tracks.zh-Hans.ts';
import { zhHant } from './caption-tracks.zh-Hant.ts';
import { ja } from './caption-tracks.ja.ts';
import { ko } from './caption-tracks.ko.ts';
import { es } from './caption-tracks.es.ts';
import { fr } from './caption-tracks.fr.ts';
import { de } from './caption-tracks.de.ts';
import { nl } from './caption-tracks.nl.ts';
import { ptBR } from './caption-tracks.pt-BR.ts';
import { it } from './caption-tracks.it.ts';
import { ru } from './caption-tracks.ru.ts';
import { pl } from './caption-tracks.pl.ts';
import { tr } from './caption-tracks.tr.ts';
import { vi } from './caption-tracks.vi.ts';

/** 字幕轨条的文案（英文是键与类型的来源，译文在 `caption-tracks.zh-Hans.ts`）。 */
const en = {
  translation: 'Translation',
  original: 'Original',
  withName: (label: string, name: string) => `${label} (${name})`,
};
export type CaptionTracksMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 字幕面板顶上的轨条（原型 panel-substrip.jsx 的 `SubTrackStrip` 与 subtrack.jsx 的 `useSubTrackOps`）：
 * 画面上有哪几份字幕，各一枚 chip；× 把它从画面上拿下（`updateItem enabled: false`，不删数据），
 * 拿下的成了虚线幽灵 chip，点它放回。拿下时最后一条拒绝，放回时第三条起问一次。
 *
 * 一枚 chip 是「一条字幕轨上的一份字幕文档」：通常就是一个字幕实例；字幕实例被切开成几段时，这几段算同一枚，
 * 拿下、放回一起动。
 */

export type ChipState =
  /** 在画面上。 */
  | 'on'
  /** 在画面上，但所在的字幕轨在时间轴行头被停用了（`visible: false`）。 */
  | 'off'
  /** 拿下来了（实例 `enabled: false`）。 */
  | 'shelved';

export interface CaptionChip {
  key: string;
  documentId: Id;
  trackId: Id;
  /** 按开始时刻排好；第一个是选中时的编辑对象。 */
  itemIds: Id[];
  kind: 'original' | 'translation';
  /** chip 上的字：原文写「原文」，译文写语言名（用这门语言自己的写法）。 */
  label: string;
  /** 提示里用的全名（文档名）。 */
  name: string;
  state: ChipState;
  /** 实例或所在轨道锁住了：拿下、放回都会被引擎拒绝。 */
  locked: boolean;
  styleDocumentId?: Id;
}

/** 字幕行是原文还是译文：看字幕文档派生自哪种文档（与预览、属性页同一个判法）。 */
export function captionKind(documentId: Id, documents: Record<Id, DocumentRecord>): 'original' | 'translation' {
  const record = documents[documentId];
  const parent = record?.sourceDocumentId ? documents[record.sourceDocumentId] : undefined;
  return parent?.kind === 'translation' ? 'translation' : 'original';
}

/** 原文 / 译文的叫法（时间线字幕行头的悬停说明）。 */
export function captionKindLabel(kind: 'original' | 'translation'): string {
  return kind === 'translation' ? M.translation : M.original;
}

/** 语言标签 → 这门语言自己的叫法（`en` → English，`ja` → 日本語）；认不出时原样返回。 */
export function languageName(tag: string): string {
  try {
    const name = new Intl.DisplayNames([tag], { type: 'language' }).of(tag);
    return name ? name.charAt(0).toLocaleUpperCase(tag) + name.slice(1) : tag;
  } catch {
    return tag;
  }
}

/** 序列上的字幕：按轨道次序、再按开始时刻排。 */
export function captionChips(sequence: Sequence, documents: Record<Id, DocumentRecord>): CaptionChip[] {
  const tracks = new Map(sequence.tracks.map((track) => [track.id, track]));
  const items = sequence.items
    .filter((item): item is CaptionItem => item.type === 'caption' && !!documents[item.documentId])
    .sort((a, b) => (tracks.get(a.trackId)?.order ?? 0) - (tracks.get(b.trackId)?.order ?? 0) || a.span.fromFrame - b.span.fromFrame);
  const groups = new Map<string, CaptionItem[]>();
  for (const item of items) {
    const key = `${item.trackId}:${item.documentId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const chips = [...groups].map(([key, members]): CaptionChip => {
    const first = members[0]!;
    const record = documents[first.documentId]!;
    const track = tracks.get(first.trackId);
    const kind = captionKind(first.documentId, documents);
    const enabled = members.filter((item) => item.enabled);
    const style = members.find((item) => item.styleDocumentId)?.styleDocumentId;
    return {
      key,
      documentId: first.documentId,
      trackId: first.trackId,
      itemIds: members.map((item) => item.id),
      kind,
      label: kind === 'translation' ? (record.language ? languageName(record.language) : M.translation) : M.original,
      name: record.name,
      state: enabled.length === 0 ? 'shelved' : track && !track.visible ? 'off' : 'on',
      locked: !!track?.locked || members.some((item) => item.locked),
      ...(style ? { styleDocumentId: style } : {}),
    };
  });
  // 同名的补上文档名；还分不开的按次序编号。
  const counts = (list: readonly CaptionChip[]) => {
    const map = new Map<string, number>();
    for (const chip of list) map.set(chip.label, (map.get(chip.label) ?? 0) + 1);
    return map;
  };
  const named = counts(chips);
  const withNames = chips.map((chip) => ((named.get(chip.label) ?? 0) > 1 ? { ...chip, label: M.withName(chip.label, chip.name) } : chip));
  const still = counts(withNames);
  const seen = new Map<string, number>();
  return withNames.map((chip) => {
    if ((still.get(chip.label) ?? 0) < 2) return chip;
    const n = (seen.get(chip.label) ?? 0) + 1;
    seen.set(chip.label, n);
    return n > 1 ? { ...chip, label: `${chip.label} ${n}` } : chip;
  });
}

/** 还在画面上的（含所在轨被停用的）。 */
export function onScreen<T extends Pick<CaptionChip, 'state'>>(chips: readonly T[]): T[] {
  return chips.filter((chip) => chip.state !== 'shelved');
}

/** 拿下、放回认得的那一枚：一枚 chip，或轨条上的一组（`CaptionGroup`）。 */
type Toggleable = Pick<CaptionChip, 'key' | 'state' | 'itemIds'>;

const toggle = (sequence: Sequence, chip: Toggleable, enabled: boolean): EditOperation[] =>
  chip.itemIds.map((itemId) => ({ type: 'updateItem', sequenceId: sequence.id, itemId, enabled }));

/** 拿下：画面上只剩这一条时拒绝（一条都不显示是「隐藏字幕」的事，不是这里）。 */
export function dropOperations(sequence: Sequence, chips: readonly Toggleable[], chip: Toggleable): { refused: 'last' } | { operations: EditOperation[] } {
  if (onScreen(chips).filter((other) => other.key !== chip.key).length === 0) return { refused: 'last' };
  return { operations: toggle(sequence, chip, false) };
}

/** 放回：画面上已有两条以上时要先问一次（`confirm` 是放回之后的条数）。 */
export function putBackOperations(sequence: Sequence, chips: readonly Toggleable[], chip: Toggleable): { confirm: number | null; operations: EditOperation[] } {
  const showing = onScreen(chips).filter((other) => other.key !== chip.key).length;
  return { confirm: showing >= 2 ? showing + 1 : null, operations: toggle(sequence, chip, true) };
}

/**
 * 轨条上的一组：同是原文（或同是译文）、同一门语言的几份字幕。纪录片一段素材转录一份、翻译一份，画面上同一层字幕就是
 * 好几份文档、散在好几条轨上；轨条按组一枚 chip，拿下、放回、套样式、倒转都对整组。列表一次仍只校对一份（一段）。
 * 没有语言的字幕文档各自成组。
 */
export interface CaptionGroup {
  key: string;
  kind: 'original' | 'translation';
  label: string;
  /** 组里的每一段（一枚 chip），按开始时刻排。 */
  segments: CaptionChip[];
  itemIds: Id[];
  /** 每段都拿下了才算拿下；画面上的几段所在轨都停用了才算停用。 */
  state: ChipState;
  /** 有一段锁着：整组拿不下来。 */
  locked: boolean;
  /** 组里各段用的样式文档（去重，按段的次序）。 */
  styleDocumentIds: Id[];
}

/** 这枚 chip 的字幕实例。 */
const spansOf = (chip: CaptionChip, sequence: Sequence) =>
  sequence.items.filter((item): item is CaptionItem => item.type === 'caption' && chip.itemIds.includes(item.id)).map((item) => item.span);

/** 这枚 chip 在时间线上最早的一帧（没有实例时排最后）。 */
export const startOf = (chip: CaptionChip, sequence: Sequence) => Math.min(...spansOf(chip, sequence).map((span) => span.fromFrame));

/** 把轨条的 chip 按「原文 / 译文 ＋ 语言」并成组，按第一次出现的次序排。 */
export function captionGroups(sequence: Sequence, chips: readonly CaptionChip[], documents: Record<Id, DocumentRecord>): CaptionGroup[] {
  const language = (chip: CaptionChip) => documents[chip.documentId]?.language ?? null;
  const buckets = new Map<string, CaptionChip[]>();
  for (const chip of chips) {
    const tag = language(chip);
    const key = tag ? `${chip.kind}:${tag}` : `${chip.kind}:${chip.key}`;
    buckets.set(key, [...(buckets.get(key) ?? []), chip]);
  }
  const groups = [...buckets].map(([key, members]): CaptionGroup => {
    const segments = members
      .map((chip) => ({ chip, from: startOf(chip, sequence) }))
      .sort((a, b) => a.from - b.from)
      .map(({ chip }) => chip);
    const showing = onScreen(segments);
    return {
      key,
      kind: segments[0]!.kind,
      label: segments[0]!.label,
      segments,
      itemIds: segments.flatMap((chip) => chip.itemIds),
      state: showing.length === 0 ? 'shelved' : showing.every((chip) => chip.state === 'off') ? 'off' : 'on',
      locked: segments.some((chip) => chip.locked),
      styleDocumentIds: [...new Set(segments.flatMap((chip) => (chip.styleDocumentId ? [chip.styleDocumentId] : [])))],
    };
  });
  // 名字按语言叫：译文写语言名，原文同时有几门时带上语言；没有语言的组照旧用 chip 的名字（同名已补过文档名）。
  const tags = new Map(groups.map((group) => [group.key, language(group.segments[0]!)]));
  const allTags = [...new Set([...tags.values()].filter((tag): tag is string => !!tag))];
  const originals = groups.filter((group) => group.kind === 'original').length;
  return groups.map((group) => {
    const tag = tags.get(group.key);
    if (!tag) return group;
    const name = languageName(shortTag(tag, allTags));
    return { ...group, label: group.kind === 'translation' ? name : originals > 1 ? M.withName(M.original, name) : M.original };
  });
}

/** 语言标签能省掉地区就省（`zh-CN` → `zh`），同一门语言有两个地区时留着。 */
function shortTag(tag: string, all: readonly string[]): string {
  const primary = tag.split('-')[0]!;
  return all.some((other) => other !== tag && other.split('-')[0] === primary) ? tag : primary;
}

/** 一段的来源名（段落选择里用）：顺着派生找到转写文档，用它的名字（素材名）；找不到时用字幕文档名。 */
export function segmentSource(chip: CaptionChip, documents: Record<Id, DocumentRecord>): string {
  let record: DocumentRecord | undefined = documents[chip.documentId];
  for (let hop = 0; record && hop < 4; hop++) {
    if (record.kind === 'speech') return record.name;
    record = record.sourceDocumentId ? documents[record.sourceDocumentId] : undefined;
  }
  return chip.name;
}

/** 这枚 chip 所在的组。 */
export function groupOf(groups: readonly CaptionGroup[], chipKey: string | null | undefined): CaptionGroup | undefined {
  return chipKey ? groups.find((group) => group.segments.some((chip) => chip.key === chipKey)) : undefined;
}

/**
 * 点一组时校对哪一段：之前选的那段还在这组里就留着；否则取盖住播放头的那段（几段都盖住时取最短的，最具体），
 * 都不盖住取第一段。拿下的段不选。
 */
export function segmentAt(group: CaptionGroup, sequence: Sequence, frame: number, previous?: string | null): CaptionChip {
  const live = onScreen(group.segments);
  const pool = live.length ? live : group.segments;
  const kept = pool.find((chip) => chip.key === previous);
  if (kept) return kept;
  let best: { chip: CaptionChip; length: number } | null = null;
  for (const chip of pool) {
    for (const span of spansOf(chip, sequence)) {
      if (frame < span.fromFrame || frame >= span.fromFrame + span.durationFrames) continue;
      if (!best || span.durationFrames < best.length) best = { chip, length: span.durationFrames };
    }
  }
  return best?.chip ?? pool[0]!;
}

/**
 * 「倒转 ⇅」能动的样式文档：画面上原文与译文叠在同一份样式里（预览按样式文档分组叠行）时，倒转就是改这份样式的
 * `order`（译文在上 / 原文在上，与属性页的「双语次序」同一个字段）。纪录片里每段素材一对原文与译文、各一份样式，
 * 倒转把这几份一起改。没有这样的一对时是空的。
 */
export function flipTargets(chips: readonly CaptionChip[]): Id[] {
  const byStyle = new Map<Id, Set<CaptionChip['kind']>>();
  for (const chip of onScreen(chips)) {
    if (!chip.styleDocumentId || chip.state !== 'on') continue;
    byStyle.set(chip.styleDocumentId, (byStyle.get(chip.styleDocumentId) ?? new Set()).add(chip.kind));
  }
  return [...byStyle].filter(([, kinds]) => kinds.size > 1).map(([id]) => id);
}
