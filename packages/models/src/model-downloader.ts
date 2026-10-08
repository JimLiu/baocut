import fs from 'node:fs/promises';
import path from 'node:path';
import { MANIFEST_FILE, sha256File, type BcutManifest } from './model-catalog.ts';
import { modelFileUrl } from './download-source.ts';
import { STAGING_DIR, removeEmptyParents, stagingDirOf } from './model-staging.ts';
import { live, type MessageRef } from '@baocut/protocol';
import { ModelsModelDownloader as M } from '@baocut/protocol/messages/models/model-downloader.ts';
import { modelTextRef, type ModelText } from './model-text.ts';

/**
 * 模型文件的下载器（架构设计 §6.3）：按清单逐个文件下载到暂存区，逐个核对大小与 sha256，整个仓库齐了再原子地发布。
 *
 * 暂存区：`<models-root>/.bcut-staging/<owner>/<repo>@<revision>/`，与模型目录在同一个卷上（发布是改名）。
 * - 没下完的文件是 `<path>.part`；核对过 sha256 的文件改名为 `<path>`。暂存区里已经核对过的文件不再下载。
 * - 续传：`.part` 已有 n 字节时带 `Range: bytes=n-`；206 且 `Content-Range` 从 n 开始就接着写，200 表示来源不支持
 *   续传，从头写。续传出来的文件 sha256 不符时，删掉从头再下一次；从头下的仍不符就是校验失败。
 * - 连不上、5xx、429 与读到一半断开按有界的退避重试（每次从已经写下的字节续传；断开前有进展时重新计数）；
 *   404、401、403 不重试。
 * - 取消（信号中止）立即停下，`.part` 留在暂存区，下次续传。
 * - 发布：把 `.bcut-manifest.json` 写进暂存目录，旧的仓库目录（如果有）改名挪开，暂存目录改名为仓库目录，再删掉旧目录。
 *
 * 错误码各带一条补救说明：`MODEL_DOWNLOAD_NO_SPACE`（磁盘空间不足）、`MODEL_DOWNLOAD_NETWORK`（网络，重试用完）、
 * `MODEL_DOWNLOAD_INTEGRITY`（大小或 sha256 不符）、`MODEL_DOWNLOAD_SOURCE`（来源没有这个文件或拒绝访问）、
 * `MODEL_MANIFEST_INCOMPLETE`（内置清单缺可信的哈希）。
 */

export type DownloadErrorCode =
  'MODEL_DOWNLOAD_NO_SPACE' | 'MODEL_DOWNLOAD_NETWORK' | 'MODEL_DOWNLOAD_INTEGRITY' | 'MODEL_DOWNLOAD_SOURCE' | 'MODEL_MANIFEST_INCOMPLETE';

// 每次读都按当前语言生成（`DownloadError.remedy` 在构造时取）。
export const DOWNLOAD_REMEDIES: Readonly<Record<DownloadErrorCode, string>> = live(() => ({
  MODEL_DOWNLOAD_NO_SPACE: M.remedyNoSpace().text,
  MODEL_DOWNLOAD_NETWORK: M.remedyNetwork().text,
  MODEL_DOWNLOAD_INTEGRITY: M.remedyIntegrity().text,
  MODEL_DOWNLOAD_SOURCE: M.remedySource().text,
  MODEL_MANIFEST_INCOMPLETE: M.remedyManifestIncomplete().text,
}));

export class DownloadError extends Error {
  readonly code: DownloadErrorCode;
  readonly remedy: string;
  readonly details: Record<string, unknown>;

  /** 用目录文字构造时的消息引用。 */
  readonly messageRef: MessageRef | undefined;

  constructor(code: DownloadErrorCode, message: ModelText, details: Record<string, unknown> = {}) {
    super(String(message));
    this.messageRef = modelTextRef(message);
    this.name = 'DownloadError';
    this.code = code;
    this.remedy = DOWNLOAD_REMEDIES[code];
    this.details = details;
  }
}

/** 要下载的一个文件。`size` 未知时只按 sha256 核对。 */
export interface DownloadFile {
  path: string;
  size: number | null;
  sha256: string;
}

export interface DownloaderOptions {
  /** 模型目录的根。 */
  root: string;
  /** 下载来源的基址（见 `download-source.ts`）。 */
  endpoint: string;
  fetch?: typeof fetch;
  /** 网络错误的重试次数（不含第一次），默认 4。 */
  retries?: number;
  /** 第 n 次重试前等多久（毫秒），默认 1、2、4、8 秒封顶。 */
  backoffMs?: (attempt: number) => number;
  /** 多久收不到数据算断开（毫秒），默认 60 秒。 */
  stallMs?: number;
}

class Retryable extends Error {
  readonly reason: string;
  readonly status: number | null;
  constructor(reason: string, status: number | null = null) {
    super(reason);
    this.reason = reason;
    this.status = status;
  }
}

/** 内容不对（多出字节）：与 sha256 不符一样处理。 */
class Oversize extends Error {}

export class ModelDownloader {
  readonly #root: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;
  readonly #retries: number;
  readonly #backoff: (attempt: number) => number;
  readonly #stallMs: number;

  constructor(options: DownloaderOptions) {
    this.#root = options.root;
    this.#endpoint = options.endpoint;
    this.#fetch = options.fetch ?? fetch;
    this.#retries = options.retries ?? 4;
    this.#backoff = options.backoffMs ?? ((attempt) => Math.min(8_000, 1_000 * 2 ** (attempt - 1)));
    this.#stallMs = options.stallMs ?? 60_000;
  }

  get endpoint(): string {
    return this.#endpoint;
  }

  /**
   * 把一个仓库版本的这些文件下载进暂存目录（已经核对过的跳过）。`onBytes` 收到写入的增量；从头重写一个文件时是负数
   * （扣掉作废的字节）。`sourceRepo` 是下载来源的仓库，与模型目录里的位置 `repo` 不同时才给（仓库清单的 `sourceRepo`）。
   */
  async download(
    repo: string,
    revision: string,
    files: readonly DownloadFile[],
    signal: AbortSignal,
    onBytes: (delta: number) => void = () => {},
    sourceRepo: string = repo,
  ): Promise<void> {
    const stage = stagingDirOf(this.#root, repo, revision);
    await fs.mkdir(stage, { recursive: true });
    for (const file of files) {
      signal.throwIfAborted();
      await this.#downloadFile(stage, modelFileUrl(this.#endpoint, sourceRepo, revision, file.path), file, signal, onBytes);
    }
  }

  /** 修复：把仓库目录里核对过的好文件硬链接（不行就复制）进暂存目录，发布时连同新下载的一起换上。 */
  async reuse(repo: string, revision: string, repoDir: string, files: readonly string[]): Promise<void> {
    const stage = stagingDirOf(this.#root, repo, revision);
    for (const file of files) {
      const target = path.join(stage, file);
      if (await exists(target)) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rm(`${target}.part`, { force: true });
      await fs.link(path.join(repoDir, file), target).catch(() => fs.copyFile(path.join(repoDir, file), target));
    }
  }

  /**
   * 发布：暂存目录里的文件写成清单，原子地换到 `<root>/<owner>/<repo>/`。`files` 是清单要列出的全部文件（含复用的），
   * 都应已在暂存目录里。
   */
  async publish(repo: string, revision: string, files: ReadonlyArray<{ path: string; sha256: string }>): Promise<BcutManifest> {
    const stage = stagingDirOf(this.#root, repo, revision);
    const entries: BcutManifest['files'] = [];
    for (const file of files) {
      const stat = await fs.stat(path.join(stage, file.path));
      entries.push({ path: file.path, size: stat.size, sha256: file.sha256, source_verified: true });
    }
    const manifest: BcutManifest = { format_version: 1, repo, revision, source: this.#endpoint, files: entries };
    await fs.writeFile(path.join(stage, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    const target = path.join(this.#root, ...repo.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const aside = `${stage}.old-${process.pid}-${Date.now()}`;
    const hadOld = await exists(target);
    if (hadOld) await fs.rename(target, aside);
    try {
      await fs.rename(stage, target);
    } catch (error) {
      if (hadOld) await fs.rename(aside, target).catch(() => {});
      throw error;
    }
    if (hadOld) await fs.rm(aside, { recursive: true, force: true });
    await removeEmptyParents(path.dirname(stage), path.join(this.#root, STAGING_DIR));
    return manifest;
  }

  async #downloadFile(
    stage: string,
    url: string,
    file: DownloadFile,
    signal: AbortSignal,
    onBytes: (delta: number) => void,
  ): Promise<void> {
    const final = path.join(stage, file.path);
    if (await exists(final)) return;
    const part = `${final}.part`;
    await fs.mkdir(path.dirname(final), { recursive: true });
    let failures = 0;
    let resumed = false;
    let cleanRetried = false;
    for (;;) {
      signal.throwIfAborted();
      let offset = await sizeOf(part);
      if (file.size !== null && offset > file.size) {
        await truncate(part, onBytes, offset);
        offset = 0;
      }
      if (offset > 0) resumed = true;
      let bad = false;
      if (file.size === null || offset < file.size) {
        try {
          await this.#fetchInto(part, url, offset, file, signal, onBytes);
        } catch (error) {
          if (signal.aborted) throw signal.reason ?? error;
          if (error instanceof Oversize) bad = true;
          else if (error instanceof Retryable) {
            // 断开之前有进展时重新计数：慢而不稳的连接只要还在前进就继续续传。
            failures = (await sizeOf(part)) > offset ? 1 : failures + 1;
            if (failures > this.#retries) {
              throw new DownloadError('MODEL_DOWNLOAD_NETWORK', M.downloadFailed({ file: file.path, reason: error.reason }), {
                file: file.path,
                reason: error.reason,
                ...(error.status !== null ? { status: error.status } : {}),
                attempts: failures,
              });
            }
            await sleep(this.#backoff(failures), signal);
            continue;
          } else throw error;
        }
      }
      if (!bad) {
        const actual = await sizeOf(part);
        bad = (file.size !== null && actual !== file.size) || (await sha256File(part)) !== file.sha256;
      }
      if (!bad) {
        await fs.rename(part, final);
        return;
      }
      await truncate(part, onBytes, await sizeOf(part));
      // 续传出来的文件不符：可能是旧的 `.part` 不对，从头再下一次。
      if (resumed && !cleanRetried) {
        cleanRetried = true;
        resumed = false;
        continue;
      }
      throw new DownloadError('MODEL_DOWNLOAD_INTEGRITY', M.integrityMismatch({ file: file.path }), {
        file: file.path,
        expectedSha256: file.sha256,
        ...(file.size !== null ? { expectedSize: file.size } : {}),
      });
    }
  }

  async #fetchInto(
    part: string,
    url: string,
    offset: number,
    file: DownloadFile,
    signal: AbortSignal,
    onBytes: (delta: number) => void,
  ): Promise<void> {
    const attempt = new AbortController();
    const onAbort = () => attempt.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    let stalled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        attempt.abort(new Error('stalled'));
      }, this.#stallMs);
    };
    try {
      arm();
      let response: Response;
      try {
        response = await this.#fetch(url, {
          headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
          signal: attempt.signal,
          redirect: 'follow',
        });
      } catch {
        if (signal.aborted) throw signal.reason;
        throw new Retryable(stalled ? 'stalled' : 'connect');
      }
      const status = response.status;
      let start = 0;
      if (status === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(response.headers.get('content-range') ?? '');
        if (!range || Number(range[1]) !== offset) {
          await response.body?.cancel().catch(() => {});
          await truncate(part, onBytes, offset);
          throw new Retryable('range-mismatch', status);
        }
        start = offset;
      } else if (status === 200) {
        if (offset > 0) await truncate(part, onBytes, offset);
      } else if (status === 416) {
        await response.body?.cancel().catch(() => {});
        // 已经收全（大小未知时由 sha256 决定）；否则从头来。
        if (file.size === null || offset === file.size) return;
        await truncate(part, onBytes, offset);
        throw new Retryable('range-not-satisfiable', status);
      } else {
        await response.body?.cancel().catch(() => {});
        if (status === 429 || status >= 500) throw new Retryable(`HTTP ${status}`, status);
        throw new DownloadError('MODEL_DOWNLOAD_SOURCE', M.sourceHttp({ file: file.path, status }), { file: file.path, status });
      }
      const length = Number(response.headers.get('content-length') ?? NaN);
      const expected = Number.isFinite(length) ? start + length : null;
      if (file.size !== null && expected !== null && expected > file.size) {
        await response.body?.cancel().catch(() => {});
        throw new Oversize();
      }
      const handle = await fs.open(part, start > 0 ? 'a' : 'w');
      let written = start;
      try {
        if (!response.body) throw new Retryable('empty-body', status);
        try {
          for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
            arm();
            if (file.size !== null && written + chunk.byteLength > file.size) throw new Oversize();
            try {
              await handle.write(chunk);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
                throw new DownloadError('MODEL_DOWNLOAD_NO_SPACE', M.diskFull(), { file: file.path });
              }
              throw error;
            }
            written += chunk.byteLength;
            onBytes(chunk.byteLength);
          }
        } catch (error) {
          if (error instanceof Oversize || error instanceof DownloadError) throw error;
          if (signal.aborted) throw signal.reason;
          throw new Retryable(stalled ? 'stalled' : 'stream-broken', status);
        }
      } finally {
        await handle.close();
      }
      if (expected !== null && written < expected) throw new Retryable('truncated', status);
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
}

/** 默认的可用空间：`statfs` 取最近的已存在的上级目录；查不到时 null。 */
export async function diskFreeBytes(dir: string): Promise<number | null> {
  let current = path.resolve(dir);
  for (;;) {
    try {
      const stats = await fs.statfs(current);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

async function truncate(part: string, onBytes: (delta: number) => void, bytes: number): Promise<void> {
  await fs.rm(part, { force: true });
  if (bytes > 0) onBytes(-bytes);
}

async function sizeOf(file: string): Promise<number> {
  const stat = await fs.stat(file).catch(() => null);
  return stat?.isFile() ? stat.size : 0;
}

async function exists(file: string): Promise<boolean> {
  return (await fs.stat(file).catch(() => null)) !== null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
