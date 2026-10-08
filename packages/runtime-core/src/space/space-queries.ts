import {
  RpcError,
  type Id,
  type JobRecord,
  type SpaceEntry,
  type SpaceListParams,
  type SpaceListResult,
  type SpaceSearchParams,
  type SpaceSearchResult,
} from '@baocut/protocol';
import type { SpaceCatalog } from '../space-catalog.ts';
import { searchSegments, type SearchableVideo } from './content-search.ts';
import { RcSpace } from '@baocut/protocol/messages/runtime-core';

/**
 * Space 的查询（`space.list`、`space.search`，以及智能体工具 `space_list`、`space_search`）与按主体的过滤（架构设计 §4.8）。
 *
 * - `user`：界面、CLI、Web（用户本人）：全部条目。
 * - `source`：会话里的智能体：会话的来源目录（所属项目，或会话自己的工作目录）里的条目，以及归属同一来源的产物。
 * - `service`：对外服务的客户端：只有范围之内（已登记项目里、在 videoId 名单上）的视频，以及由这些视频生成、导出的条目；
 *   任务的产物与占位只看自己提交的。没有来源视频的文件（项目里的图片、文档）不可见。看不到的与不存在的一样回答。
 */
export type SpaceViewer =
  | { kind: 'user' }
  | { kind: 'source'; projectId: Id | null; conversationId: Id }
  | { kind: 'service'; videos: 'all' | ReadonlySet<Id>; owns: (record: JobRecord) => boolean; jobs: (jobId: Id) => JobRecord | null };

export const USER_VIEWER: SpaceViewer = { kind: 'user' };

const DEFAULT_LIST_LIMIT = 100;
const DEFAULT_SEARCH_LIMIT = 50;

export function projectOf(entry: SpaceEntry): Id | null {
  return (entry.origin?.capability === 'link-import' ? entry.origin.projectId : entry.source.projectId ?? entry.origin?.projectId) ?? null;
}

/** 条目关联的视频：视频本身，或生成、导出它的视频。 */
export function videoOf(entry: SpaceEntry): Id | null {
  if (entry.ref && 'videoId' in entry.ref) return entry.ref.videoId;
  return entry.origin?.videoId ?? null;
}

export function visibleTo(viewer: SpaceViewer, entry: SpaceEntry): boolean {
  switch (viewer.kind) {
    case 'user':
      return true;
    case 'source':
      if (viewer.projectId) return projectOf(entry) === viewer.projectId;
      return (
        entry.source.conversationId === viewer.conversationId ||
        (!projectOf(entry) && entry.origin?.conversationId === viewer.conversationId)
      );
    case 'service': {
      const videoId = videoOf(entry);
      if (!videoId || !projectOf(entry)) return false;
      if (viewer.videos !== 'all' && !viewer.videos.has(videoId)) return false;
      const jobId = entry.origin?.jobId;
      if (!jobId) return true;
      const record = viewer.jobs(jobId);
      return record !== null && viewer.owns(record);
    }
  }
}

/** 看不到的与不存在的一样回答。 */
export function visibleEntry(catalog: SpaceCatalog, viewer: SpaceViewer, entryId: Id): SpaceEntry {
  const entry = catalog.get(entryId);
  if (!visibleTo(viewer, entry)) throw new RpcError('not-found', RcSpace.entryGone());
  return entry;
}

export function listEntries(catalog: SpaceCatalog, viewer: SpaceViewer, params: SpaceListParams): SpaceListResult {
  const kinds = params.kind === undefined ? null : new Set(Array.isArray(params.kind) ? params.kind : [params.kind]);
  const statuses = params.status === undefined ? null : new Set(Array.isArray(params.status) ? params.status : [params.status]);
  const trash = params.trash ?? 'exclude';
  const matched = catalog.entries().filter((entry) => {
    if (!visibleTo(viewer, entry)) return false;
    if (params.projectId !== undefined && projectOf(entry) !== params.projectId) return false;
    if (kinds && !kinds.has(entry.kind)) return false;
    if (statuses && !statuses.has(entry.status ?? 'none')) return false;
    if (params.videoId !== undefined && videoOf(entry) !== params.videoId) return false;
    if (params.favorite !== undefined && entry.user.favorite !== params.favorite) return false;
    const trashed = entry.user.trashedAt !== null;
    if (trash === 'exclude' && trashed) return false;
    if (trash === 'only' && !trashed) return false;
    return true;
  });
  const offset = params.cursor ? Number(params.cursor) : 0;
  const limit = params.limit ?? DEFAULT_LIST_LIMIT;
  const page = matched.slice(offset, offset + limit);
  const next = offset + page.length;
  return {
    entries: page,
    total: matched.length,
    nextCursor: next < matched.length ? String(next) : null,
    // 来源目录的扫描问题会说出目录：只给用户本人。
    issues: viewer.kind === 'user' ? catalog.issues() : [],
    scanning: catalog.scanning,
  };
}

/**
 * 跨视频检索（§5.11）。范围是来源目录里的视频（按主体过滤之后）；还没有索引、正在重建、索引落后于当前版本的视频
 * 计入 `pendingVideos`，有它们时 `complete` 为 false。落后的视频照样用旧的索引检索。
 */
export function searchContent(catalog: SpaceCatalog, viewer: SpaceViewer, params: SpaceSearchParams): SpaceSearchResult {
  const index = catalog.index;
  const wanted = params.videoIds ? new Set(params.videoIds) : null;
  const searchable: SearchableVideo[] = [];
  let pending = 0;
  for (const video of catalog.videos()) {
    if (params.projectId !== undefined && video.projectId !== params.projectId) continue;
    if (!visibleVideo(viewer, video)) continue;
    const indexed = index?.at(video.dir) ?? null;
    if (!indexed) {
      // 还不知道它的 videoId：按 videoId 筛时也算进待索引（无法判断，结果宁可标成不完整）。对外服务只在范围是全部视频时算，
      // 名单范围之外的视频不能从计数里露出来。
      if (viewer.kind !== 'service' || viewer.videos === 'all') pending++;
      continue;
    }
    if (wanted && !wanted.has(indexed.videoId)) continue;
    if (viewer.kind === 'service' && viewer.videos !== 'all' && !viewer.videos.has(indexed.videoId)) continue;
    if (index!.pendingCount([video.dir]) > 0) pending++;
    searchable.push({
      videoId: indexed.videoId,
      videoName: indexed.name,
      entryId: video.entryId,
      projectId: video.projectId,
      revision: indexed.revision,
      segments: indexed.segments,
    });
  }
  const { hits, truncated } = searchSegments(searchable, {
    query: params.query,
    ...(params.kinds ? { kinds: params.kinds } : {}),
    ...(params.speaker ? { speaker: params.speaker } : {}),
    limit: params.limit ?? DEFAULT_SEARCH_LIMIT,
  });
  return { hits, complete: pending === 0 && !catalog.scanning && index !== null, pendingVideos: pending, truncated };
}

/** 视频按主体的初筛（检索与工具的候选输入共用）；对外服务的 videoId 名单要等拿到 videoId 之后再查。 */
export function visibleVideo(viewer: SpaceViewer, video: { projectId: Id | null; conversationId: Id | null }): boolean {
  switch (viewer.kind) {
    case 'user':
      return true;
    case 'source':
      return viewer.projectId ? video.projectId === viewer.projectId : video.conversationId === viewer.conversationId;
    case 'service':
      // 只有已登记项目里的视频；名单在拿到 videoId 之后再查。
      return video.projectId !== null;
  }
}
