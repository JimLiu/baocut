import {
  defineMessages,
  live,
  SPACE_SEARCH_MAX_LIMIT,
  type FileTarget,
  type Id,
  type SpaceEntry,
  type SpaceSearchDocumentKind,
  type SpaceSearchHit,
  type SpaceSearchParams,
  type SpaceSearchResult,
} from '@baocut/protocol';
import { formatClock } from './format.ts';
import { videoTargetOf } from './space.ts';
import { zhHans } from './space-search.zh-Hans.ts';
import { zhHant } from './space-search.zh-Hant.ts';
import { ja } from './space-search.ja.ts';
import { ko } from './space-search.ko.ts';
import { es } from './space-search.es.ts';
import { fr } from './space-search.fr.ts';
import { de } from './space-search.de.ts';
import { nl } from './space-search.nl.ts';
import { ptBR } from './space-search.pt-BR.ts';
import { it } from './space-search.it.ts';
import { ru } from './space-search.ru.ts';
import { pl } from './space-search.pl.ts';
import { tr } from './space-search.tr.ts';
import { vi } from './space-search.vi.ts';

/** 内容命中的文案（译文在 `space-search.<语言>.ts`）。 */
const en = {
  documentKind: { speech: 'Transcript', caption: 'Subtitles', translation: 'Translation', chapter: 'Chapter' } satisfies Record<
    SpaceSearchDocumentKind,
    string
  >,
  pendingVideos: (count: number) =>
    `The content index for ${count} ${count === 1 ? 'video' : 'videos'} hasn’t finished updating; results may be missing videos or out of date`,
  indexUpdating: 'The content index is updating; results may be out of date',
  truncated: (count: number) => `Too many matches; showing only the first ${count}`,
  /** 几条说明连成一句。 */
  notes: (notes: readonly string[]) => `${notes.join('; ')}.`,
  sourceTime: (clock: string) => `Asset time ${clock}`,
};
export type SpaceSearchMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * Space 的内容命中（架构设计 §5.11 跨视频的内容检索）：搜索框里的词同时查条目名（本地筛选）与视频的内容索引
 * （`space.search`：转录、字幕、译文、章节）。这里只决定命中怎么写、点了去哪里。
 */

/** 输入停下多久再去查内容索引。 */
export const SEARCH_DEBOUNCE_MS = 300;
/** 一次最多要多少条内容命中：按视频分组、每组分页显示，取到合同的上限，少让一个视频的命中把别的视频挤出结果。 */
export const SEARCH_LIMIT = SPACE_SEARCH_MAX_LIMIT;

export const DOCUMENT_KIND_LABEL: Record<SpaceSearchDocumentKind, string> = live(() => M.documentKind);

/** 片段按命中位置切开：命中的部分标出来。位置是 UTF-16 下标，越界与重叠的收拢。 */
export function snippetParts(snippet: string, highlights: readonly [number, number][]): { text: string; hit: boolean }[] {
  const ranges = highlights
    .map(([a, b]) => [Math.max(0, Math.min(a, snippet.length)), Math.max(0, Math.min(b, snippet.length))] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of ranges) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const parts: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [a, b] of merged) {
    if (a > at) parts.push({ text: snippet.slice(at, a), hit: false });
    parts.push({ text: snippet.slice(a, b), hit: true });
    at = b;
  }
  if (at < snippet.length) parts.push({ text: snippet.slice(at), hit: false });
  return parts;
}

/** 打开命中所在的视频用的定位：Space 条目，或按 videoId 找到的视频条目；视频此刻不在任何来源目录里时 null。 */
export function hitTarget(hit: Pick<SpaceSearchHit, 'entryId' | 'videoId'>, entries: readonly SpaceEntry[]): FileTarget | null {
  const entry = entries.find((e) => (hit.entryId ? e.id === hit.entryId : !!e.ref && 'videoId' in e.ref && e.ref.videoId === hit.videoId));
  if (entry && entry.kind === 'video' && !entry.user.trashedAt) return videoTargetOf(entry);
  return hit.entryId && !entry ? { entryId: hit.entryId } : null;
}

/** 打开后跳到哪一秒：只有序列时间能直接跳；源时间不跳。 */
export function seekSeconds(hit: Pick<SpaceSearchHit, 'time'>): number | null {
  return hit.time.clock === 'sequence' ? hit.time.start : null;
}

/** 结果不全时的一句说明（索引在重建或增量更新、命中太多）。全的时候 null。 */
export function searchNote(result: Pick<SpaceSearchResult, 'complete' | 'pendingVideos' | 'truncated' | 'hits'>): string | null {
  const notes: string[] = [];
  if (!result.complete) {
    notes.push(
      result.pendingVideos > 0 ? M.pendingVideos(result.pendingVideos) : M.indexUpdating,
    );
  }
  if (result.truncated) notes.push(M.truncated(result.hits.length));
  return notes.length ? M.notes(notes) : null;
}

/* ---------- 过滤与分组（设计稿 model-project-search.js 的字段标签与 planRows，page-projects.jsx 的 HitGroup） ---------- */

/** 文档种类：全部，或只看一种（合同 `kinds`）。 */
export type HitKindFilter = 'all' | SpaceSearchDocumentKind;
export const HIT_KIND_FILTERS: readonly HitKindFilter[] = ['all', 'speech', 'caption', 'translation', 'chapter'];

export interface HitFilter {
  kind: HitKindFilter;
  /** 只看这位说话人（从命中里认出来的名字）；null 是不限。 */
  speaker: string | null;
}

export const ANY_HIT: HitFilter = { kind: 'all', speaker: null };

/** `space.search` 的参数：全部种类不传 `kinds`，不限说话人不传 `speaker`；`projectId` 为 null 是全部项目，'none' 是不属于项目的视频。 */
export function searchRequest(query: string, projectId: Id | 'none' | null, filter: HitFilter): SpaceSearchParams {
  return {
    query,
    limit: SEARCH_LIMIT,
    ...(projectId === null ? {} : { projectId: projectId === 'none' ? null : projectId }),
    ...(filter.kind === 'all' ? {} : { kinds: [filter.kind] }),
    ...(filter.speaker ? { speaker: filter.speaker } : {}),
  };
}

/** Runtime 按「名字里含有」找说话人；下拉里选的是一个确切的名字，「宝玉」不该带出「宝玉的嘉宾」。 */
export function exactSpeaker(hits: readonly SpaceSearchHit[], speaker: string | null): SpaceSearchHit[] {
  return speaker ? hits.filter((hit) => hit.speaker === speaker) : [...hits];
}

/** 这批命中里的说话人，并进已经见过的（同一个词换种类时下拉不缩水）。 */
export function collectSpeakers(seen: readonly string[], hits: readonly Pick<SpaceSearchHit, 'speaker'>[]): string[] {
  const names = new Set(seen);
  for (const hit of hits) if (hit.speaker) names.add(hit.speaker);
  return names.size === seen.length ? [...seen] : [...names];
}

/** 说话人下拉的选项：见过的加上已选的，按名字排。 */
export function speakerOptions(seen: readonly string[], selected: string | null): string[] {
  const names = new Set(seen);
  if (selected) names.add(selected);
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export interface HitGroup {
  videoId: Id;
  videoName: string;
  hits: SpaceSearchHit[];
}

/**
 * 按视频分组（设计稿：同一个视频里命中十几条时，平铺会把别的视频挤出去，「哪些视频里有这个词」才是这一屏要回答的）。
 * 组按第一次出现的先后，组里保持 Runtime 给的顺序（按时间）。
 */
export function groupHits(hits: readonly SpaceSearchHit[]): HitGroup[] {
  const groups = new Map<Id, HitGroup>();
  for (const hit of hits) {
    const group = groups.get(hit.videoId);
    if (group) group.hits.push(hit);
    else groups.set(hit.videoId, { videoId: hit.videoId, videoName: hit.videoName, hits: [hit] });
  }
  return [...groups.values()];
}

/** 每组先给几条，「再显示 N 条」一次再放这么多（设计稿 PAGE）。 */
export const GROUP_PAGE = 10;

/** 一组显示到哪（设计稿 `planRows`）：`shown` 没给时一页；`more` 是下一次再放几条，`next` 是放完之后的条数。 */
export function planGroupRows<T>(rows: readonly T[], shown?: number, pageSize = GROUP_PAGE): { rows: T[]; rest: number; more: number; next: number } {
  const take = Math.max(0, Math.min(shown ?? pageSize, rows.length));
  const rest = rows.length - take;
  return { rows: rows.slice(0, take), rest, more: Math.min(rest, pageSize), next: take + pageSize };
}

/** 命中行前面的标签（设计稿的 chip）：文档种类，译文带语言（「译文 · en」）。 */
export function hitChip(hit: Pick<SpaceSearchHit, 'documentKind' | 'language'>): string {
  const label = DOCUMENT_KIND_LABEL[hit.documentKind];
  return hit.documentKind === 'translation' && hit.language ? `${label} · ${hit.language}` : label;
}

/** 命中行的位置：时间（源时间如实写「素材时间」）· 说话人。 */
export function hitWhere(hit: Pick<SpaceSearchHit, 'time' | 'speaker'>): string {
  const clock = formatClock(hit.time.start);
  const parts = [hit.time.clock === 'sequence' ? clock : M.sourceTime(clock)];
  if (hit.speaker) parts.push(hit.speaker);
  return parts.join(' · ');
}
