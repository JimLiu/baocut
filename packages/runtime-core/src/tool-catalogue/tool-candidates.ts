import type {
  Id,
  ToolCandidate,
  ToolCandidateDocument,
  ToolCandidatesParams,
  ToolCandidatesResult,
  ToolDefinition,
} from '@baocut/protocol';
import type { SpaceCatalog } from '../space-catalog.ts';
import type { VideoFacts } from '../space/content-extract.ts';
import { visibleVideo, type SpaceViewer } from '../space/space-queries.ts';

/**
 * 工具的候选输入（`tools.candidates`，架构设计 §7.9）：可选的视频条目与每个条目里可选的文档。事实来自 Space 目录（§5.7）
 * 与内容索引（§5.11），不打开视频。
 *
 * - 范围与 `space.list` / `space.search` 相同：按主体过滤（`SpaceViewer`），可以按项目筛；回收站里的视频不列。
 * - `videos`：全部视频；`videos-with-transcript`：有文稿的视频，每个视频列出它的文稿与已有的译文、配音组。
 * - 还没有索引、排队重读（旧版本的缓存、视频改过）、读失败的视频照样列出，标 `indexed: false`：有文稿才列的工具也列出它，
 *   因为不能断定没有文稿；这时 `complete` 为 false。旧的索引有文稿时照用旧的。
 * - 对外服务只在范围是全部视频时把没有索引的视频算进来（与 `space.search` 一样，名单之外的视频不能从结果里露出来）。
 */

const DEFAULT_LIMIT = 100;

export function toolCandidates(
  catalog: SpaceCatalog,
  viewer: SpaceViewer,
  tool: ToolDefinition,
  params: Omit<ToolCandidatesParams, 'toolId'>,
): ToolCandidatesResult {
  const index = catalog.index;
  const matched: ToolCandidate[] = [];
  let pending = 0;
  if (tool.candidates !== null) {
    for (const video of catalog.videos()) {
      if (params.projectId !== undefined && video.projectId !== params.projectId) continue;
      if (!visibleVideo(viewer, video)) continue;
      const entry = catalog.get(video.entryId);
      if (entry.user.trashedAt !== null) continue;
      const indexed = index?.at(video.dir) ?? null;
      const videoId = indexed?.videoId ?? video.videoId;
      if (viewer.kind === 'service' && viewer.videos !== 'all') {
        // 名单范围：不知道 videoId 的视频不列（不能判断在不在名单上）。
        if (!videoId || !viewer.videos.has(videoId)) continue;
      }
      const current = index !== null && indexed !== null && index.current(video.dir);
      if (!current) pending++;
      const documents = tool.candidates === 'videos-with-transcript' && indexed ? transcriptChoices(indexed.facts) : [];
      // 有文稿才列的工具：索引是当前的、而且确实没有文稿时才不列。
      if (tool.candidates === 'videos-with-transcript' && current && documents.length === 0) continue;
      matched.push({
        entryId: video.entryId,
        videoId,
        name: entry.name,
        projectId: video.projectId,
        lastActivityAt: video.lastActivityAt,
        indexed: current,
        indexedRevision: indexed?.revision ?? null,
        documents,
      });
    }
  }
  const offset = params.cursor ? Number(params.cursor) : 0;
  const limit = params.limit ?? DEFAULT_LIMIT;
  const page = matched.slice(offset, offset + limit);
  const next = offset + page.length;
  return {
    toolId: tool.id,
    candidates: page,
    total: matched.length,
    nextCursor: next < matched.length ? String(next) : null,
    complete: pending === 0 && !catalog.scanning && index !== null,
    pendingVideos: pending,
    scanning: catalog.scanning,
  };
}

/** 视频里可选的文稿，带上译自它的译文与用它的配音组。 */
function transcriptChoices(facts: VideoFacts): ToolCandidateDocument[] {
  const transcripts = facts.transcripts ?? [];
  const translations = facts.translations ?? [];
  const dubGroups = facts.dubGroups ?? [];
  const sourceOf = new Map<Id, Id | null>(translations.map((t) => [t.documentId, t.sourceDocumentId]));
  return transcripts.map((transcript) => ({
    ...transcript,
    kind: 'speech' as const,
    translations: translations
      .filter((t) => t.sourceDocumentId === transcript.documentId)
      .map((t) => ({ documentId: t.documentId, language: t.language, units: t.units, staleUnits: t.staleUnits })),
    dubs: dubGroups
      .filter(
        (g) =>
          g.transcriptId === transcript.documentId || (g.translationId !== null && sourceOf.get(g.translationId) === transcript.documentId),
      )
      .map((g) => ({ groupId: g.groupId, language: g.language, translationId: g.translationId })),
  }));
}
