import { AI_TOOL_TOPIC_DEFAULT_CHUNKS, RpcError, mediaTimeToSeconds, type Id, type SpaceEntry } from '@baocut/protocol';
import type { Harness } from '@baocut/harness';
import type { TrustedPrincipal } from '../gateway.ts';
import type { RpcHandlers } from '../handlers.ts';
import type { SpaceCatalog } from '../space-catalog.ts';
import type { VideoTrash } from '../videos/video-trash.ts';
import type { SpaceThumbnails } from './space-thumbnails.ts';
import { continueInConversation } from './space-continue.ts';
import { USER_VIEWER, listEntries, searchContent, searchScope, visibleEntry, type SpaceViewer } from './space-queries.ts';
import { readCitations, type CitationArtifacts } from './space-citations.ts';
import { relatedVideos } from './related-videos.ts';
import { resolveSearchHit } from './search-hit-resolver.ts';
import { reasonOf, semanticError } from './semantic/errors.ts';
import { lexicalOnlySearch, type SemanticServices } from './semantic/services.ts';
import { RcSpace } from '@baocut/protocol/messages/runtime-core';

type SpaceMethod =
  | 'space.list'
  | 'space.get'
  | 'space.search'
  | 'space.import'
  | 'space.rename'
  | 'space.setFavorite'
  | 'space.trash'
  | 'space.restore'
  | 'space.purge'
  | 'space.openForEdit'
  | 'space.thumbnail'
  | 'space.hitMoments'
  | 'space.continueInConversation'
  | 'space.rebuildIndex'
  | 'space.searchV2'
  | 'space.indexStatus'
  | 'space.indexBuild'
  | 'space.indexControl'
  | 'space.resolveSearchHit'
  | 'space.citations'
  | 'space.relevantChunks'
  | 'space.relatedVideos';

export interface SpaceMethodDeps {
  harness: Harness;
  /** 删除与恢复视频：视频条目进出回收站转到这里。 */
  trash: VideoTrash;
  /** 条目的缩略图（`space.thumbnail`）。 */
  thumbnails: SpaceThumbnails;
  /** 本机语义检索（`space.searchV2`、`space.index*`、`space.resolveSearchHit`）。不给时只有字面一路，建索引报没装模型。 */
  semantic?: SemanticServices | null;
  /** 任务产物库（`space.citations` 读出处旁文件）。 */
  artifacts?: CitationArtifacts | null;
}

/**
 * 改用户标记（`space.update`、`space.trash`、`space.restore`）。视频条目进出回收站不是写标记，是移动视频目录（§5.5）：
 * 移入回收站转为 `videos.delete`，恢复删除了的视频转为 `videos.restore`，前提与错误一样。其余字段照常写标记。
 */
export async function updateEntry(
  space: SpaceCatalog,
  trash: VideoTrash,
  params: { entryId: Id; favorite?: boolean; displayName?: string | null; trashed?: boolean },
  principal: TrustedPrincipal,
): Promise<SpaceEntry> {
  const { trashed, ...marks } = params;
  const hasMarks = marks.favorite !== undefined || marks.displayName !== undefined;
  if (trashed === true && isLiveVideo(space, params.entryId)) {
    if (hasMarks) await space.update(marks);
    const deleted = await trash.delete({ entryId: params.entryId }, principal);
    return space.get(deleted.entryId);
  }
  if (trashed === false && space.trashedVideo(params.entryId)) {
    const { entry } = await trash.restore(params.entryId);
    return hasMarks ? space.update({ ...marks, entryId: entry.id }) : entry;
  }
  // 已经删除了的视频再移入回收站（重复的请求）：照样回答回收站里的条目。
  const trashedVideo = trashed === true ? space.trashedVideo(params.entryId) : null;
  if (trashedVideo) return hasMarks ? space.update({ ...marks, entryId: trashedVideo.entryId }) : space.get(trashedVideo.entryId);
  return space.update(params);
}

function isLiveVideo(space: SpaceCatalog, entryId: Id): boolean {
  try {
    space.videoEntry(entryId);
    return true;
  } catch {
    return false;
  }
}

/** 网关上的主体看 Space 的范围（`space.*` 与工具的候选输入 `tools.candidates` 共用）：对外服务不走这里。 */
export function viewerOf(principal: TrustedPrincipal): SpaceViewer {
  if (principal.kind === 'service') throw new RpcError('forbidden', RcSpace.serviceUsesMcp());
  return USER_VIEWER;
}

/**
 * `space.*` 的处理函数（架构设计 §5.7、§5.11），由 `handlers.ts` 并进方法表。网关上的主体（界面、CLI、Web）都是用户本人，
 * 看全部条目；对外服务不走网关，它们的范围在工具层（`space_list` / `space_search`）。Web 的白名单与 `space.import` 的路径约束
 * 在 `services/web-handlers.ts`。
 */
export function spaceMethods(space: SpaceCatalog, deps: SpaceMethodDeps): Pick<RpcHandlers['methods'], SpaceMethod> {
  const { harness, trash, thumbnails } = deps;
  const semantic = deps.semantic ?? null;
  const search = semantic?.search ?? lexicalOnlySearch(space);
  return {
    'space.list': (p, principal) => listEntries(space, viewerOf(principal), p),
    'space.get': (p, principal) => ({ entry: visibleEntry(space, viewerOf(principal), p.entryId) }),
    'space.search': (p, principal) => searchContent(space, viewerOf(principal), p),
    'space.import': (p, principal) => {
      viewerOf(principal);
      return space.importFile({ projectId: p.projectId, file: p.path, ...(p.name ? { name: p.name } : {}) });
    },
    'space.rename': async (p) => ({ entry: await space.update({ entryId: p.entryId, displayName: p.name }) }),
    'space.setFavorite': async (p) => ({ entry: await space.update({ entryId: p.entryId, favorite: p.favorite }) }),
    'space.trash': async (p, principal) => ({ entry: await updateEntry(space, trash, { entryId: p.entryId, trashed: true }, principal) }),
    'space.restore': async (p, principal) => ({
      entry: await updateEntry(space, trash, { entryId: p.entryId, trashed: false }, principal),
    }),
    'space.purge': (p) => space.purge(p.entryId),
    'space.openForEdit': (p) => space.openForEdit(p.entryId),
    'space.thumbnail': (p, principal) => thumbnails.of(visibleEntry(space, viewerOf(principal), p.entryId)),
    'space.hitMoments': (p, principal) => thumbnails.moments(visibleEntry(space, viewerOf(principal), p.entryId), p.spans),
    'space.continueInConversation': (p, principal) => {
      viewerOf(principal);
      return continueInConversation(space, harness, p);
    },
    'space.rebuildIndex': () => space.rebuild(),
    'space.searchV2': (p, principal) => search.searchV2(viewerOf(principal), p),
    'space.indexStatus': (p, principal) => search.indexStatus(viewerOf(principal), p),
    'space.indexBuild': async (p, principal) => {
      const viewer = viewerOf(principal);
      const channels = p.channels ?? ['text'];
      // 画面要有取帧来源（桌面与 Web 的 Runtime 都有）；声音通道还没有实现。
      if (channels.some((channel) => channel !== 'text' && (channel !== 'visual' || !semantic?.coordinator.visual))) {
        throw semanticError('CHANNEL_UNAVAILABLE');
      }
      const scheduler = semantic?.scheduler();
      if (!semantic || !scheduler) throw semanticError('MODEL_NOT_INSTALLED');
      if (!semantic.store()) throw semanticError('INDEX_NOT_READY');
      if (channels.includes('visual')) {
        // 只装了文字模型包时画面建不了：现在就告诉调用方（`details.channel` 指明缺的是能读图的模型包）。
        await scheduler.profile('text-to-visual').catch((error: unknown) => {
          throw semanticError(reasonOf(error), { channel: 'visual' });
        });
      }
      // 范围与检索相同：主体看得到的、按项目与 videoId 筛过的视频。
      const dirs = new Set(searchScope(space, viewer, p).videos.map((v) => v.dir));
      const planned = semantic.coordinator.build(
        space.videos().filter((video) => dirs.has(video.dir)),
        { ...(p.rebuild ? { rebuild: true } : {}), channels },
      );
      return { jobId: null, planned };
    },
    'space.indexControl': async (p, principal) => {
      viewerOf(principal);
      if (!semantic?.store()) throw semanticError('INDEX_NOT_READY');
      if (p.action === 'pause') semantic.coordinator.pause();
      else if (p.action === 'resume') semantic.coordinator.resume();
      else await semantic.coordinator.clear();
      return { paused: semantic.coordinator.paused };
    },
    'space.resolveSearchHit': (p, principal) =>
      resolveSearchHit(semantic?.resolver ?? { catalog: space, reader: null }, viewerOf(principal), p.hitId),
    'space.citations': async (p, principal) => ({
      citations: await readCitations(visibleEntry(space, viewerOf(principal), p.entryId), deps.artifacts ?? null),
    }),
    'space.relatedVideos': async (p, principal) => relatedVideos(space, semantic, viewerOf(principal), p),
    'space.relevantChunks': async (p, principal) => {
      const viewer = viewerOf(principal);
      // 与 `ai-tool` 的按主题选材同一个查询（`ai-tool-wiring.ts`）：没有语义服务时是 `none`，界面照样发整篇。
      if (!semantic) return { effectiveMode: 'none', reason: 'MODEL_NOT_INSTALLED', coverage: { chapters: [], stale: false }, chunks: [] };
      const set = await semantic.context(viewer).findRelevantChunks({
        intent: p.intent,
        scope: { videoIds: p.videoIds, view: 'sequence' },
        channel: 'text',
        limit: p.limit ?? AI_TOOL_TOPIC_DEFAULT_CHUNKS,
        order: 'time',
        neighbors: 1,
        kinds: ['speech'],
      });
      return {
        effectiveMode: set.effectiveMode,
        reason: set.reason,
        coverage: { chapters: set.coverage.chapters, stale: set.coverage.stale },
        chunks: set.chunks.map((chunk) => ({
          chunkId: chunk.chunkId,
          videoId: chunk.videoId,
          chapter: chunk.chapter?.title ?? null,
          clock: chunk.anchor.clock,
          start: chunk.sentences[0]?.start ?? mediaTimeToSeconds(chunk.anchor.start),
          end: chunk.sentences.at(-1)?.end ?? mediaTimeToSeconds(chunk.anchor.end),
          text: chunk.text,
          ...(chunk.weak ? { weak: true } : {}),
        })),
      };
    },
  };
}
