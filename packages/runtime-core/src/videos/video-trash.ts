import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RpcError,
  nowIso,
  refOf,
  type FileTarget,
  type Id,
  type JobRecord,
  type VideoDeleteResult,
  type VideoRestoreResult,
} from '@baocut/protocol';
import type { Logger } from '@baocut/harness';
import type { TrashedVideo } from '@baocut/runtime-storage';
import type { TrustedPrincipal } from '../gateway.ts';
import { TRASH_DIR, type SpaceCatalog, type VideoEntryInfo } from '../space-catalog.ts';
import type { VideoService } from './video-service.ts';
import { RcVideo } from '@baocut/protocol/messages/runtime-core';

/**
 * 删除与恢复视频（架构设计 §5.5、§5.7）。删除是把整个视频目录移进同一个来源目录里的回收站 `.bcut-trash/<trashId>/<目录名>`：
 * 同一个卷上的改名，不复制、不删任何东西，可以恢复；物理删除走 Space 的 `space.purge` 与回收站的保留期，在那里查引用。
 *
 * - 链接素材的原文件不在视频目录里，删除与物理删除都不碰；物理删除只删归视频管理的文件（`SpaceCatalog.#purgeVideo`）。
 * - 视频目录是来源目录本身（项目目录、会话的工作目录）或装着某个来源目录时，动任何东西之前以 `VIDEO_TRASH_SOURCE_ROOT` 拒绝。
 * - 删除前：别的连接打开着（`VIDEO_IN_USE`）、有内部租约或进行中的任务与导出（`VIDEO_BUSY`）时拒绝；只有调用方自己打开着时先替它关掉
 *   （`video.closed`，`reason: 'deleted'`）。移动期间持有视频的写锁，别的进程锁着时是引擎的 `VIDEO_LOCKED`。
 * - 先在 `space.json` 里记下删除（记录与回收站标记），再移动目录；移动失败时去掉记录。中途崩溃由 Space 启动时按目录实际在哪里核对。
 * - 回收站里的条目 id 由来源与它在回收站里的位置决定（原来的位置之后可能放进另一个视频）；删除之前的 id 仍可用来撤销与恢复。
 */

export interface VideoTrashDeps {
  space: SpaceCatalog;
  videos: VideoService;
  jobs: { list(): JobRecord[] };
  /** 文件目标到来源目录与文件（与 `videos.open` 同一个解析）。 */
  resolve: (target: FileTarget) => { root: string; file: string };
  log: Logger;
}

export type VideoDeleteTarget = FileTarget | { videoId: Id };

export class VideoTrash {
  readonly #deps: VideoTrashDeps;
  readonly #log: Logger;
  /** 删除与恢复一个接一个做：两次移动不会交错。 */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(deps: VideoTrashDeps) {
    this.#deps = deps;
    this.#log = deps.log.child('video-trash');
  }

  delete(target: VideoDeleteTarget, principal: TrustedPrincipal): Promise<VideoDeleteResult> {
    return this.#serial(() => this.#delete(target, principal));
  }

  restore(entryId: Id): Promise<VideoRestoreResult> {
    return this.#serial(() => this.#restore(entryId));
  }

  #serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => {});
    return next;
  }

  async #delete(target: VideoDeleteTarget, principal: TrustedPrincipal): Promise<VideoDeleteResult> {
    const { space, videos } = this.#deps;
    // 已经删除了的（重复的请求、撤销之前又点了一次）：照样回答同一个结果。
    if ('entryId' in target) {
      const trashed = space.trashedVideo(target.entryId);
      if (trashed) return this.#result(trashed.entryId, trashed.record);
    }
    const info = await this.#locate(target);
    const dir = await fs.realpath(info.dir);
    const rootReal = await fs.realpath(info.root);
    // 视频目录是来源目录本身（或装着某个来源目录）：改名会把项目或会话的目录整个挪走，也挪不进自己的子目录。动任何东西之前拒绝。
    if (await this.#holdsSourceRoot(dir, rootReal)) throw sourceRootError();
    const indexed = info.entry.ref && 'videoId' in info.entry.ref ? info.entry.ref.videoId : null;
    const videoId =
      indexed ??
      (await videos
        .peek(dir)
        .then((v) => v.videoId)
        .catch(() => null));

    if (videoId) {
      const usage = videos.usage(videoId);
      const others = usage?.openers.filter((id) => id !== principal.connectionId) ?? [];
      if (others.length > 0) {
        throw new RpcError('conflict', RcVideo.openElsewhere(), { code: 'VIDEO_IN_USE', videoId });
      }
      const running = this.#deps.jobs
        .list()
        .filter((job) => job.videoId === videoId && (job.state === 'queued' || job.state === 'running'));
      if ((usage?.leases ?? 0) > 0 || running.length > 0) {
        throw new RpcError('conflict', RcVideo.videoBusy(), {
          code: 'VIDEO_BUSY',
          videoId,
          jobIds: running.map((job) => job.jobId),
        });
      }
      if (usage) await videos.closeDeleted(videoId);
    }

    const trashId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    const trashRelPath = `${TRASH_DIR}/${trashId}/${path.basename(dir)}`;
    const trashDir = path.join(rootReal, ...trashRelPath.split('/'));
    const entryId = space.trashEntryId(info.sourceKey, trashRelPath);
    const record: TrashedVideo = {
      formerEntryId: info.entry.id,
      sourceKey: info.sourceKey,
      projectId: 'projectId' in info.scope ? info.scope.projectId : null,
      conversationId: 'conversationId' in info.scope ? info.scope.conversationId : null,
      relPath: info.relPath,
      trashRelPath,
      videoId,
      name: info.entry.name,
      size: info.entry.size,
      trashedAt: nowIso(),
    };
    await videos.withWriteLock(dir, async () => {
      await space.recordTrashedVideo(entryId, record);
      try {
        await fs.mkdir(path.dirname(trashDir), { recursive: true });
        await fs.rename(dir, trashDir);
      } catch (error) {
        await space.releaseTrashedVideo(entryId, record, record.relPath);
        await fs.rmdir(path.dirname(trashDir)).catch(() => {});
        if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
          throw new RpcError('conflict', RcVideo.crossDevice(), { code: 'VIDEO_TRASH_CROSS_DEVICE' });
        }
        throw error;
      }
    });
    this.#log.info('Video deleted (moved to trash)', { entryId, videoId });
    await space.refreshSource(info.sourceKey);
    return this.#result(entryId, record);
  }

  #result(entryId: Id, record: TrashedVideo): VideoDeleteResult {
    const related = record.videoId
      ? this.#deps.space
          .entries()
          .filter((e) => e.id !== entryId && e.origin?.videoId === record.videoId)
          .map((e) => e.id)
      : [];
    return { status: 'trashed', entryId, videoId: record.videoId, name: record.name, trashedAt: record.trashedAt, related };
  }

  async #locate(target: VideoDeleteTarget): Promise<VideoEntryInfo> {
    const { space, videos } = this.#deps;
    if ('entryId' in target) return space.videoEntry(target.entryId);
    let dir: string | null = null;
    if ('videoId' in target) {
      const known = space.videos().find((v) => v.videoId === target.videoId);
      if (known) return space.videoEntry(known.entryId);
      dir = videos.ref(target.videoId)?.path ?? null;
    } else {
      const { root, file } = this.#deps.resolve(target);
      dir = path.resolve(root, file);
      if (/^(video|movie)\.db$/.test(path.basename(dir))) dir = path.dirname(dir);
      // 路径只在给定的项目或会话目录里找：不借一个来源的名义删另一个来源里的视频。
      const rel = path.relative(root, dir);
      if (rel === '' && (await isVideoDir(dir))) throw sourceRootError();
      if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) dir = null;
    }
    const info = dir ? await space.videoEntryAt(dir) : null;
    if (!info) throw new RpcError('not-found', RcVideo.videoEntryNotFound());
    return info;
  }

  /** `dir` 是不是某个来源目录本身，或者装着某个来源目录（都按真实路径比）。 */
  async #holdsSourceRoot(dir: string, rootReal: string): Promise<boolean> {
    const roots = [rootReal, ...(await Promise.all(this.#deps.space.sourceRoots().map((root) => fs.realpath(root).catch(() => null))))];
    return roots.some((root) => {
      if (!root) return false;
      const rel = path.relative(dir, root);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
  }

  async #restore(entryId: Id): Promise<VideoRestoreResult> {
    const { space } = this.#deps;
    const trashed = space.trashedVideo(entryId);
    if (!trashed) {
      const entry = space.get(entryId);
      if (entry.kind === 'video' && entry.user.trashedAt === null) return { entry, relPath: entry.relPath, renamed: false };
      throw new RpcError('invalid-request', RcVideo.notDeletedVideo(), { code: 'VIDEO_NOT_TRASHED' });
    }
    const { record, root } = trashed;
    if (!root) throw new RpcError('not-found', RcVideo.restoreRootGone());
    const rootReal = await fs.realpath(root);
    const from = path.join(rootReal, ...record.trashRelPath.split('/'));
    await fs.access(path.join(from, 'video.db')).catch(async () => {
      await fs.access(path.join(from, 'movie.db')).catch(() => {
        throw new RpcError('not-found', RcVideo.trashDirGone());
      });
    });
    const wanted = path.join(rootReal, ...record.relPath.split('/'));
    await fs.mkdir(path.dirname(wanted), { recursive: true });
    let to = wanted;
    for (let n = 2; await exists(to); n++) to = `${wanted} ${n}`;
    await fs.rename(from, to);
    await fs.rmdir(path.dirname(from)).catch(() => {});
    await fs.rmdir(path.join(rootReal, TRASH_DIR)).catch(() => {});
    const relPath = path.relative(rootReal, to).split(path.sep).join('/');
    const restored = await space.releaseTrashedVideo(trashed.entryId, record, relPath);
    this.#log.info('Video restored', { entryId: restored, videoId: record.videoId });
    return { entry: space.get(restored), relPath, renamed: to !== wanted };
  }
}

function sourceRootError(): RpcError {
  const remedy = RcVideo.sourceRootRemedy();
  return new RpcError('conflict', RcVideo.sourceRootInTrash(), {
    code: 'VIDEO_TRASH_SOURCE_ROOT',
    remedy: remedy.text,
    remedyRef: refOf(remedy),
  });
}

async function isVideoDir(dir: string): Promise<boolean> {
  for (const name of ['video.db', 'movie.db']) if (await exists(path.join(dir, name))) return true;
  return false;
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}
