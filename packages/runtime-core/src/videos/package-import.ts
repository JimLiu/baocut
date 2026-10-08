import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RpcError, type Id, type RpcParams, type VideoOpenResult } from '@baocut/protocol';
import type { TrustedPrincipal } from '../gateway.ts';
import { PackageError, readPackage } from '../exports/package-reader.ts';
import { videoDirName, type VideoService } from './video-service.ts';
import { RcVideo } from '@baocut/protocol/messages/runtime-core';

/**
 * 打开便携包（`videos.importPackage`，视频格式规范 §8）：在来源目录里的隐藏暂存目录边核对边解开包（清单的格式与打包版本、
 * 每个文件的长度与 sha256、路径与条目种类，见 `package-reader.ts`），再由引擎把它建成一个新视频（新的 `videoId`，
 * 素材全部收进视频；引擎再核对一遍文档与素材的摘要和引用）。任何一步失败都不留下视频目录；暂存目录在任何结局下都删掉，
 * 进程被强杀留下的由下次启动时的残留清理删掉（`leftover-files.ts`）。
 *
 * 开给桌面界面、CLI 与 Web 服务（Web 在处理函数里把文件限制在来源目录里），以及会话与终端的工具目录（`videos_import_package`，
 * 同一个入口）；对外服务（MCP）没有这个入口。
 */

type Scope = { projectId: Id } | { conversationId: Id };

/** 来源目录里的暂存目录名：`.baocut-import-<8 位十六进制>`。 */
const STAGING_NAME = /^\.baocut-import-[0-9a-f]{8}$/;

/** 进行中的打开用着的暂存目录（真实路径）。启动时的残留清理跳过它们；同一进程里的各个入口共用。 */
const activeStaging = new Set<string>();

export function isImportStagingName(name: string): boolean {
  return STAGING_NAME.test(name);
}

export function activeImportStaging(): ReadonlySet<string> {
  return activeStaging;
}

export class PackageImporter {
  readonly #videos: VideoService;
  readonly #commands = new Map<Id, Promise<VideoOpenResult>>();

  constructor(videos: VideoService) {
    this.#videos = videos;
  }

  /** `options.name`：视频目录用这个名字（不给时用包里的视频名）。 */
  import(
    params: RpcParams<'videos.importPackage'>,
    root: string,
    scope: Scope,
    principal: TrustedPrincipal,
    options: { name?: string } = {},
  ): Promise<VideoOpenResult> {
    if (params.commandId) {
      const existing = this.#commands.get(params.commandId);
      if (existing) return existing;
    }
    const run = this.#run(params.path, root, scope, principal, options.name);
    if (params.commandId) {
      const key = params.commandId;
      this.#commands.set(key, run);
      run.catch(() => this.#commands.delete(key));
    }
    return run;
  }

  async #run(given: string, root: string, scope: Scope, principal: TrustedPrincipal, name: string | undefined): Promise<VideoOpenResult> {
    const rootReal = await fs.realpath(root).catch(() => {
      throw new RpcError('not-found', RcVideo.sourceDirNotFound());
    });
    const file = await fs.realpath(path.isAbsolute(given) ? given : path.resolve(rootReal, given)).catch(() => {
      throw new RpcError('not-found', RcVideo.packageNotFound(), { code: 'PACKAGE_NOT_FOUND' });
    });
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new RpcError('invalid-request', RcVideo.packageNotFile(), { code: 'PACKAGE_INVALID' });

    const staging = path.join(rootReal, `.baocut-import-${randomUUID().slice(0, 8)}`);
    activeStaging.add(staging);
    try {
      await fs.mkdir(staging);
      let manifest;
      try {
        ({ manifest } = await readPackage(file, { extractTo: staging }));
      } catch (error) {
        if (error instanceof PackageError) throw new RpcError('invalid-request', error.message, { ...error.details, code: error.code }, error.messageRef);
        throw error;
      }
      const base = videoDirName(name ?? manifest.videoName);
      let dir = path.join(rootReal, base);
      for (let n = 2; await exists(dir); n++) dir = path.join(rootReal, `${base} ${n}`);
      return await this.#videos.createFromPackage(dir, staging, rootReal, scope, principal);
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      activeStaging.delete(staging);
    }
  }
}

async function exists(file: string): Promise<boolean> {
  return fs.lstat(file).then(
    () => true,
    () => false,
  );
}
