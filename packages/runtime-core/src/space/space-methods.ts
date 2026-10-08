import { RpcError, type Id, type SpaceEntry } from '@baocut/protocol';
import type { Harness } from '@baocut/harness';
import type { TrustedPrincipal } from '../gateway.ts';
import type { RpcHandlers } from '../handlers.ts';
import type { SpaceCatalog } from '../space-catalog.ts';
import type { VideoTrash } from '../videos/video-trash.ts';
import type { SpaceThumbnails } from './space-thumbnails.ts';
import { continueInConversation } from './space-continue.ts';
import { USER_VIEWER, listEntries, searchContent, visibleEntry, type SpaceViewer } from './space-queries.ts';
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
  | 'space.continueInConversation'
  | 'space.rebuildIndex';

export interface SpaceMethodDeps {
  harness: Harness;
  /** 删除与恢复视频：视频条目进出回收站转到这里。 */
  trash: VideoTrash;
  /** 条目的缩略图（`space.thumbnail`）。 */
  thumbnails: SpaceThumbnails;
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
    'space.continueInConversation': (p, principal) => {
      viewerOf(principal);
      return continueInConversation(space, harness, p);
    },
    'space.rebuildIndex': () => space.rebuild(),
  };
}
