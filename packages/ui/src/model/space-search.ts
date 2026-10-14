import {
  defineMessages,
  live,
  SEMANTIC_QUERY_MAX_CHARS,
  SPACE_SEARCH_MAX_LIMIT,
  SPACE_SEARCH_V2_MAX_LIMIT,
  type FileTarget,
  type Id,
  type SpaceEntry,
  type SpaceSearchDocumentKind,
  type SpaceSearchHit,
  type SpaceSearchParams,
  type SpaceSearchResult,
  type SpaceSearchV2Hit,
  type SpaceSearchV2Params,
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

/** 命中所在视频的 Space 条目（「交给 Agent」带它进会话）；不在 Space 里或在回收站里的没有。 */
export function hitVideoEntry(hit: Pick<SpaceSearchHit, 'entryId' | 'videoId'>, entries: readonly SpaceEntry[]): SpaceEntry | null {
  const entry = entries.find((e) => (hit.entryId ? e.id === hit.entryId : !!e.ref && 'videoId' in e.ref && e.ref.videoId === hit.videoId));
  return entry && entry.kind === 'video' && !entry.user.trashedAt ? entry : null;
}

/**
 * 「用于写作」（创作辅助集成设计 §2.1）：只给讲话内容的命中（写作按主题从这部视频的讲话里挑材料，字幕、译文、章节不是），
 * 只在有 AI 工具 Tab 的宿主（网页没有）。
 */
export function canWriteFromHit(hit: Pick<SpaceSearchHit, 'documentKind'>, web: boolean): boolean {
  return !web && hit.documentKind === 'speech';
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
export function exactSpeaker<T extends Pick<SpaceSearchHit, 'speaker'>>(hits: readonly T[], speaker: string | null): T[] {
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

export interface HitGroup<T extends SpaceSearchHit = SpaceSearchHit> {
  videoId: Id;
  videoName: string;
  hits: T[];
}

/**
 * 按视频分组（设计稿：同一个视频里命中十几条时，平铺会把别的视频挤出去，「哪些视频里有这个词」才是这一屏要回答的）。
 * 组按第一次出现的先后，组里保持 Runtime 给的顺序（按时间）。
 */
export function groupHits<T extends SpaceSearchHit>(hits: readonly T[]): HitGroup<T>[] {
  const groups = new Map<Id, HitGroup<T>>();
  for (const hit of hits) {
    const group = groups.get(hit.videoId);
    if (group) group.hits.push(hit);
    else groups.set(hit.videoId, { videoId: hit.videoId, videoName: hit.videoName, hits: [hit] });
  }
  return [...groups.values()];
}

/**
 * 弱命中折起来（检索规范 §11.3，设计稿 model-space-search.js `fold`）：有明显相关的结果时，只是勉强相关的收在后面，点开才显示；
 * 全是弱命中时照常全给（每行写「只是勉强相关」）。字面模式的命中没有 `weak`，不折。顺序不变。
 */
export function foldWeakHits<T extends object>(hits: readonly T[]): { shown: T[]; folded: T[] } {
  const weak = (hit: T) => 'weak' in hit && hit.weak === true;
  const strong = hits.filter((hit) => !weak(hit));
  return strong.length ? { shown: strong, folded: hits.filter(weak) } : { shown: [...hits], folded: [] };
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

/* ---------- 综合搜索（`space.searchV2`，创作辅助集成设计 §2.4；设计稿 model-space-search.js） ---------- */

/** 「综合」按意思与字面两路找、按名次融合；「精确文字」是原来的 `space.search`（全部词都出现）。 */
export type SpaceSearchMode = 'hybrid' | 'lexical';

/** `space.searchV2` 的参数：只找讲话内容；说话人由界面按整串筛（V2 没有 `speaker`）。 */
export function searchV2Request(query: string, projectId: Id | 'none' | null, filter: HitFilter): SpaceSearchV2Params {
  return {
    query: { kind: 'text', text: query.slice(0, SEMANTIC_QUERY_MAX_CHARS) },
    mode: 'hybrid',
    channels: ['text'],
    limit: SPACE_SEARCH_V2_MAX_LIMIT,
    ...(projectId === null ? {} : { projectId: projectId === 'none' ? null : projectId }),
    ...(filter.kind === 'all' ? {} : { kinds: [filter.kind] }),
  };
}

/**
 * 综合搜索的命中摊平成与 `space.search` 同一个形状，分组、分页、筛说话人与打开都复用；另带它自己的几样：怎么找到的、
 * 还在不在时间线上、要不要先按当前版本重新解析。只收讲话内容（文档句群）的命中。
 */
export interface SemanticHitRow extends SpaceSearchHit {
  hitId: string;
  matchedBy: SpaceSearchV2Hit['matchedBy'];
  inTimeline: boolean;
  needsResolve: boolean;
  /** 弱命中：只是按意思勉强沾边（`SpaceSearchV2Hit.weak`）。 */
  weak: boolean;
}

export function semanticHitRows(hits: readonly SpaceSearchV2Hit[]): SemanticHitRow[] {
  const rows: SemanticHitRow[] = [];
  for (const hit of hits) {
    if (hit.target.kind !== 'document-span') continue;
    rows.push({
      videoId: hit.target.videoId,
      videoName: hit.videoName ?? hit.target.videoId,
      entryId: hit.entryId,
      projectId: hit.projectId,
      documentId: hit.target.documentId,
      documentKind: hit.target.documentKind,
      language: hit.language,
      speaker: hit.speaker,
      snippet: hit.snippet,
      highlights: hit.highlights,
      time: { clock: hit.anchor.clock, start: hit.anchor.startSec, end: hit.anchor.endSec },
      indexedRevision: hit.indexedRevision,
      hitId: hit.hitId,
      matchedBy: hit.matchedBy,
      inTimeline: hit.actions.includes('open-in-timeline'),
      needsResolve: hit.needsResolve,
      weak: hit.weak ?? false,
    });
  }
  return rows;
}

/* ---------- 编辑器文稿查找条下的「意思相近」（创作辅助集成设计 §2.1；设计稿 model-space-search.js `inVideo`） ---------- */

/** 最多列几句。 */
export const MEANING_IN_VIDEO_SHOWN = 5;

/** 要不要按意思找：至少两个字，正则查找时不找。 */
export function meaningQueryReady(query: string, regex: boolean): boolean {
  return !regex && [...query.trim()].length >= 2;
}

/** 只在这部视频的讲话内容里找，命中按当前时间线投影。 */
export function meaningInVideoRequest(query: string, videoId: Id): SpaceSearchV2Params {
  return {
    query: { kind: 'text', text: query.trim().slice(0, SEMANTIC_QUERY_MAX_CHARS) },
    mode: 'hybrid',
    channels: ['text'],
    videoIds: [videoId],
    kinds: ['speech'],
    view: 'sequence',
    limit: SPACE_SEARCH_V2_MAX_LIMIT,
  };
}

/** 只留意思相近、原句里没有这些字的（字面命中已在文稿里高亮），按时间排，最多 `MEANING_IN_VIDEO_SHOWN` 句。 */
export function meaningInVideoRows(hits: readonly SpaceSearchV2Hit[]): SemanticHitRow[] {
  return semanticHitRows(hits)
    .filter((row) => matchedByKind(row.matchedBy) === 'semantic')
    .slice(0, MEANING_IN_VIDEO_SHOWN)
    .sort((a, b) => a.time.start - b.time.start);
}

/** 怎么找到的（设计稿 `BY`）：两路都对上、只是字面、只是意思相近。不写分数。 */
export function matchedByKind(matchedBy: readonly ('lexical' | 'semantic')[]): 'both' | 'lexical' | 'semantic' {
  const lexical = matchedBy.includes('lexical');
  const semantic = matchedBy.includes('semantic');
  return lexical && semantic ? 'both' : semantic ? 'semantic' : 'lexical';
}

/** 命中原因里写出的词最多几个（设计稿 model-space-search.js `why`）。 */
export const WHY_WORDS_MAX = 3;

/**
 * 命中原因里写出的词：片段里标出来的字面命中，按出现先后、去掉重复（不分大小写），最多 `WHY_WORDS_MAX` 个。纯语义命中没有高亮，
 * 这里为空：不编造概念名。
 */
export function hitWords(hit: Pick<SpaceSearchHit, 'snippet' | 'highlights'>): string[] {
  const words: string[] = [];
  const seen = new Set<string>();
  for (const part of snippetParts(hit.snippet, hit.highlights)) {
    const word = part.text.trim();
    if (!part.hit || !word || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    words.push(word);
    if (words.length === WHY_WORDS_MAX) break;
  }
  return words;
}
