import path from 'node:path';
import type { PipelineTargets, VideoLease, VideoPlace } from '@baocut/jobs';
import { RpcError, newId, type Id, type PipelineCreateScope } from '@baocut/protocol';
import type { TrustedPrincipal } from '../gateway.ts';
import type { SpaceCatalog } from '../space-catalog.ts';
import { hasVideoDb, reserveVideoDir, type VideoLocation, type VideoService } from './video-service.ts';
import { RcVideo } from '@baocut/protocol/messages/runtime-core';

/**
 * 固定流程的视频目标（架构设计 §7.9）在 Runtime 里的实现：
 *
 * - 位置（`VideoPlace`）与重启恢复用的同形：来源目录、视频目录、来源（项目或会话）。
 * - 以租约打开：用一个只在打开那一刻存在的主体打开（别的连接已经打开着时直接接上那一份），换成 Runtime 的租约后马上离开；
 *   被别的进程锁着时引擎的 `VIDEO_LOCKED` 原样抛出。租约放下之后没有别的打开者时按宽限期关闭。
 * - 新建：与 `videos.create` 同一条路径（项目目录、目录命名、新视频的初始内容），之后同样换成租约。给的是会话时与智能体的
 *   `videos_create` 同样放置：会话属于项目时在项目里（范围是项目），否则在会话的工作目录里（范围是会话）。流程先占下目录
 *   （`reserve`，建成空目录）再新建到那里；那里已经有视频（上次新建之后、流程记下产出之前中断了）时打开它，不再新建。
 */

/** 已打开视频的位置；不是从项目或会话打开的（没有来源）时 null。 */
export function videoPlace(videos: VideoService, videoId: Id): VideoPlace | null {
  const ref = videos.ref(videoId);
  if (!ref) return null;
  const scope = ref.source.projectId
    ? { projectId: ref.source.projectId }
    : ref.source.conversationId
      ? { conversationId: ref.source.conversationId }
      : null;
  if (!scope) return null;
  // 来源目录：视频目录去掉相对路径。
  const depth = ref.relPath ? ref.relPath.split('/').length : 0;
  const root = path.resolve(ref.path, ...Array<string>(depth).fill('..'));
  return { root, file: ref.relPath || '.', scope };
}

/** 位置换成打开视频用的定位；形状不对时 null。 */
export function placeLocation(place: VideoPlace): VideoLocation | null {
  const { root, file, scope } = place as { root?: unknown; file?: unknown; scope?: unknown };
  if (typeof root !== 'string' || typeof file !== 'string' || !scope || typeof scope !== 'object') return null;
  const s = scope as { projectId?: unknown; conversationId?: unknown };
  if (typeof s.projectId === 'string') return { root, file, scope: { projectId: s.projectId } };
  if (typeof s.conversationId === 'string') return { root, file, scope: { conversationId: s.conversationId } };
  return null;
}

/**
 * Space 里的视频条目的位置（不打开视频）。在回收站里（含删除之前的条目 id）`SPACE_ENTRY_TRASHED`；不是视频
 * `SPACE_ENTRY_NOT_VIDEO`；不在了 `not-found`。
 */
export function entryPlace(space: SpaceCatalog, entryId: Id): VideoPlace {
  if (space.trashedVideo(entryId)) {
    throw new RpcError('conflict', RcVideo.videoInTrash(), { code: 'SPACE_ENTRY_TRASHED', entryId });
  }
  const info = space.videoEntry(entryId);
  return { root: info.root, file: info.dir, scope: info.scope };
}

export interface PipelineTargetsOptions {
  /** Space 条目的位置（`entryPlace`）。Space 在 Runtime 启动的后面才有，调用时再取。 */
  entry(entryId: Id): VideoPlace;
  /** 项目目录；不存在时 `not-found`。 */
  projectRoot(projectId: Id): string;
  /**
   * 会话的来源（与智能体的 `videos_create` 相同）：属于项目时是项目目录与项目范围，否则是会话的工作目录与会话范围；
   * 会话不存在时 `not-found`。不给时不接受按会话新建。
   */
  conversationSource?(conversationId: Id): { root: string; scope: { projectId: Id } | { conversationId: Id } };
}

export function pipelineTargets(videos: VideoService, options: PipelineTargetsOptions): PipelineTargets {
  /** 打开者换成租约：打开用的主体马上离开，视频由租约保持打开。 */
  const toLease = async (videoId: Id, principal: TrustedPrincipal, fallback: VideoPlace | null): Promise<VideoLease> => {
    videos.retain(videoId);
    await videos.close(videoId, principal);
    const place = videoPlace(videos, videoId) ?? fallback;
    if (!place) {
      videos.release(videoId);
      throw new RpcError('not-found', RcVideo.videoNotInSourceDir());
    }
    let held = true;
    return {
      videoId,
      place,
      release: () => {
        if (!held) return;
        held = false;
        videos.release(videoId);
      },
    };
  };

  /** 新建视频的来源目录与范围：项目，或会话的来源（属于项目的会话是那个项目）。 */
  const source = (request: PipelineCreateScope): { root: string; scope: { projectId: Id } | { conversationId: Id } } => {
    if (request.projectId !== undefined) return { root: options.projectRoot(request.projectId), scope: { projectId: request.projectId } };
    if (!options.conversationSource) {
      throw new RpcError('invalid-request', RcVideo.cantCreateInSession(), { code: 'PIPELINE_TARGET_UNSUPPORTED' });
    }
    return options.conversationSource(request.conversationId);
  };

  return {
    entry: async (entryId) => options.entry(entryId),
    async lease(place) {
      const location = placeLocation(place);
      if (!location) throw new RpcError('not-found', RcVideo.targetLocationIncomplete());
      const principal = targetPrincipal();
      const opened = await videos.open(location, principal);
      return toLease(opened.ref.videoId, principal, place);
    },
    async reserve(request) {
      const { root, scope } = source(request);
      const file = await reserveVideoDir(root, request.name);
      return { root: path.resolve(root), file, scope };
    },
    async create(request) {
      const { name, commandId, place } = request;
      const { root, scope } = source(request);
      const principal = targetPrincipal();
      if (place) {
        const location = placeLocation(place);
        if (!location || !sameScope(location.scope, scope) || path.resolve(location.root) !== path.resolve(root)) {
          throw new RpcError('invalid-request', RcVideo.reservedDirOutsideProject());
        }
        if (await hasVideoDb(path.join(location.root, location.file))) {
          const opened = await videos.open(location, principal);
          return toLease(opened.ref.videoId, principal, place);
        }
        const opened = await videos.create({ name, commandId }, root, scope, principal, location.file);
        return toLease(opened.ref.videoId, principal, place);
      }
      const opened = await videos.create({ name, commandId }, root, scope, principal);
      return toLease(opened.ref.videoId, principal, null);
    },
  };
}

function sameScope(a: { projectId: Id } | { conversationId: Id }, b: { projectId: Id } | { conversationId: Id }): boolean {
  return 'projectId' in a
    ? 'projectId' in b && a.projectId === b.projectId
    : 'conversationId' in b && a.conversationId === b.conversationId;
}

/** 流程打开视频的主体：每次一个，只在打开的一刻用（随即换成租约）。 */
function targetPrincipal(): TrustedPrincipal {
  return { connectionId: newId('system:pipeline-target'), kind: 'cli', name: RcVideo.pipelinePrincipalName().text };
}
