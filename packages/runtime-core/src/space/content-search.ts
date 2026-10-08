import type { Id, SpaceSearchDocumentKind, SpaceSearchHit } from '@baocut/protocol';
import type { CandidateFilter, SegmentRow } from './content-store.ts';

/**
 * 内容索引上的检索（架构设计 §5.11）。段落存在 SQLite 库里（`content-store.ts`），FTS5 的 trigram 索引缩小候选范围，
 * 命中与片段仍按下面的规则在这里判定：
 *
 * - 文字先做 NFKC 与小写：全角半角、大小写不区分。
 * - 查询按空白切成几个词，同一段里都出现才算命中。中文不分词：按字符的子串匹配，「剪辑」能找到「视频剪辑」，
 *   代价是没有词边界（「剪」也会命中「剪刀」）。三个字符以上的词走 FTS 的 MATCH，更短的退回子串过滤（逐段扫）。
 * - 没有相关度排序：按调用方给的视频顺序（最近活动在前），同一个视频里按时间。
 */

export interface SearchableVideo {
  /** 视频目录的真实路径（内容索引的键）。 */
  dir: string;
  videoId: Id;
  videoName: string;
  entryId: Id | null;
  projectId: Id | null;
  revision: string;
}

export interface SearchQuery {
  query: string;
  kinds?: readonly SpaceSearchDocumentKind[];
  speaker?: string;
  limit: number;
}

/** 给出可能命中的段落（`ContentStore.candidates`）。 */
export interface SegmentSource {
  candidates(filter: CandidateFilter): SegmentRow[];
}

const SNIPPET_MAX = 120;
const SNIPPET_BEFORE = 30;

export function normalizeText(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

export function searchTerms(query: string): string[] {
  return [...new Set(normalizeText(query).split(/\s+/).filter(Boolean))];
}

export function searchSegments(
  source: SegmentSource,
  videos: readonly SearchableVideo[],
  query: SearchQuery,
): { hits: SpaceSearchHit[]; truncated: boolean } {
  const terms = searchTerms(query.query);
  const speaker = query.speaker ? normalizeText(query.speaker.trim()) : null;
  const kinds = query.kinds && query.kinds.length > 0 ? query.kinds : null;
  if (videos.length === 0) return { hits: [], truncated: false };
  const byDir = new Map<string, SegmentRow[]>();
  for (const video of videos) byDir.set(video.dir, []);
  for (const row of source.candidates({ terms, kinds, speaker })) byDir.get(row.dir)?.push(row);
  const hits: SpaceSearchHit[] = [];
  for (const video of videos) {
    const rows = byDir.get(video.dir)!;
    rows.sort((a, b) => a.start - b.start || kindOrder(a.kind) - kindOrder(b.kind) || a.id - b.id);
    for (const segment of rows) {
      const found = matchTerms(segment.text, terms);
      if (!found) continue;
      if (hits.length >= query.limit) return { hits, truncated: true };
      hits.push({
        videoId: video.videoId,
        videoName: video.videoName,
        entryId: video.entryId,
        projectId: video.projectId,
        documentId: segment.documentId,
        documentKind: segment.kind,
        language: segment.language,
        time: { clock: segment.clock, start: segment.start, end: segment.end },
        ...found,
        speaker: segment.speaker,
        indexedRevision: video.revision,
      });
    }
  }
  return { hits, truncated: false };
}

/** 所有词都在这段文字里时，返回截取的片段与词在片段里的位置；没有词（只按说话人找）时整段算命中。 */
export function matchTerms(text: string, terms: readonly string[]): { snippet: string; highlights: [number, number][] } | null {
  const normalized = normalizeText(text);
  // NFKC 可能改变长度（连字、某些兼容字符）：那时片段用规范化之后的文字，位置才对得上。
  const display = normalized.length === text.length ? text : normalized;
  const ranges: [number, number][] = [];
  for (const term of terms) {
    let at = normalized.indexOf(term);
    if (at < 0) return null;
    while (at >= 0) {
      ranges.push([at, at + term.length]);
      at = normalized.indexOf(term, at + term.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  if (display.length <= SNIPPET_MAX) return { snippet: display, highlights: merged };
  const first = merged[0]?.[0] ?? 0;
  const start = Math.max(0, Math.min(first - SNIPPET_BEFORE, display.length - SNIPPET_MAX));
  const end = Math.min(display.length, start + SNIPPET_MAX);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < display.length ? '…' : '';
  const shift = prefix.length - start;
  const highlights = merged
    .filter(([a, b]) => a < end && b > start)
    .map(([a, b]) => [Math.max(a, start) + shift, Math.min(b, end) + shift] as [number, number]);
  return { snippet: `${prefix}${display.slice(start, end)}${suffix}`, highlights };
}

function kindOrder(kind: SpaceSearchDocumentKind): number {
  return kind === 'chapter' ? 0 : kind === 'speech' ? 1 : kind === 'caption' ? 2 : 3;
}
