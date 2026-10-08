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
export function onScreen(chips: readonly CaptionChip[]): CaptionChip[] {
  return chips.filter((chip) => chip.state !== 'shelved');
}

const toggle = (sequence: Sequence, chip: CaptionChip, enabled: boolean): EditOperation[] =>
  chip.itemIds.map((itemId) => ({ type: 'updateItem', sequenceId: sequence.id, itemId, enabled }));

/** 拿下：画面上只剩这一条时拒绝（一条都不显示是「隐藏字幕」的事，不是这里）。 */
export function dropOperations(sequence: Sequence, chips: readonly CaptionChip[], chip: CaptionChip): { refused: 'last' } | { operations: EditOperation[] } {
  if (onScreen(chips).filter((other) => other.key !== chip.key).length === 0) return { refused: 'last' };
  return { operations: toggle(sequence, chip, false) };
}

/** 放回：画面上已有两条以上时要先问一次（`confirm` 是放回之后的条数）。 */
export function putBackOperations(sequence: Sequence, chips: readonly CaptionChip[], chip: CaptionChip): { confirm: number | null; operations: EditOperation[] } {
  const showing = onScreen(chips).filter((other) => other.key !== chip.key).length;
  return { confirm: showing >= 2 ? showing + 1 : null, operations: toggle(sequence, chip, true) };
}

/**
 * 「倒转 ⇅」能动的样式文档：画面上原文与译文叠在同一份样式里（预览按样式文档分组叠行）时，倒转就是改这份样式的
 * `order`（译文在上 / 原文在上，与属性页的「双语次序」同一个字段）。没有这样一组时返回 null。
 */
export function flipTarget(chips: readonly CaptionChip[]): Id | null {
  const byStyle = new Map<Id, Set<CaptionChip['kind']>>();
  for (const chip of onScreen(chips)) {
    if (!chip.styleDocumentId || chip.state !== 'on') continue;
    byStyle.set(chip.styleDocumentId, (byStyle.get(chip.styleDocumentId) ?? new Set()).add(chip.kind));
  }
  for (const [id, kinds] of byStyle) if (kinds.size > 1) return id;
  return null;
}
