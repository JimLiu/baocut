import fs from 'node:fs/promises';
import path from 'node:path';
import { RpcError } from '@baocut/protocol';
import { RcStickers } from '@baocut/protocol/messages/runtime-core';
import { downloadToolFile, sha256File, type ToolDownloadOptions } from './external-tools/tool-download.ts';

/**
 * 线上素材（动态贴纸、Codex Pets 的精灵图）：不随应用打包，用到时从素材 CDN 取，核对大小与 sha256 之后存进本机缓存
 * （`<home>/cache/online-assets/<路径>`），之后离线也能用。桌面与 Web 都经 Runtime 取，页面不直接连 CDN。
 *
 * - 地址是 `<基址>/<路径>`；基址取 `BAOCUT_ASSETS_URL`，没有时是 [`DEFAULT_ONLINE_ASSETS_URL`]。CDN 上的文件不改：内容
 *   变了换路径，清单（随包的 `provenance.json` 等）跟着换。
 * - 缓存里的文件每个进程第一次用时核对一次 sha256，对不上就重下。
 * - 同一个文件同时被要几次只下一次。
 */

/** 素材 CDN 的默认基址。 */
export const DEFAULT_ONLINE_ASSETS_URL = 'https://cdn.baocut.com';

export function resolveOnlineAssetsUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.BAOCUT_ASSETS_URL?.trim() || DEFAULT_ONLINE_ASSETS_URL).replace(/\/+$/, '');
}

/** 清单里的一个文件：`path` 是 CDN 与缓存里的相对路径（`/` 分隔）。 */
export interface OnlineAsset {
  path: string;
  sha256: string;
  bytes: number;
}

export interface OnlineAssetsOptions {
  baseUrl: string;
  cacheDir: string;
  /** 测试用：替换下载的 `fetch` 与重试节奏。 */
  download?: ToolDownloadOptions;
  /** 一个文件最多下多久（默认 2 分钟）。 */
  timeoutMs?: number;
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class OnlineAssets {
  readonly #options: OnlineAssetsOptions;
  readonly #pending = new Map<string, Promise<string>>();
  /** 这个进程里核对过的 `路径@sha256`。 */
  readonly #verified = new Set<string>();

  constructor(options: OnlineAssetsOptions) {
    this.#options = options;
  }

  get cacheDir(): string {
    return this.#options.cacheDir;
  }

  /** 文件在缓存里的绝对路径：缓存里有且对得上就直接用，否则先下载。下不来时是 `ONLINE_ASSET_UNAVAILABLE`。 */
  ensure(asset: OnlineAsset): Promise<string> {
    const segments = asset.path.split('/');
    if (!segments.every((segment) => SEGMENT.test(segment))) throw new Error(`Bad online asset path: ${asset.path}`);
    const key = `${asset.path}@${asset.sha256}`;
    const pending = this.#pending.get(key);
    if (pending) return pending;
    const file = path.join(this.#options.cacheDir, ...segments);
    const task = this.#ensure(asset, file, key).finally(() => this.#pending.delete(key));
    this.#pending.set(key, task);
    return task;
  }

  async #ensure(asset: OnlineAsset, file: string, key: string): Promise<string> {
    if (this.#verified.has(key) && (await isFile(file))) return file;
    if ((await sizeOf(file)) === asset.bytes && (await sha256File(file)) === asset.sha256) {
      this.#verified.add(key);
      return file;
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    const part = `${file}.part`;
    const url = `${this.#options.baseUrl}/${asset.path}`;
    try {
      await downloadToolFile(
        url,
        part,
        { size: asset.bytes, sha256: asset.sha256, fileName: path.basename(file) },
        { signal: AbortSignal.timeout(this.#options.timeoutMs ?? 120_000), onBytes: () => {} },
        this.#options.download,
      );
      await fs.rename(part, file);
    } catch (error) {
      throw new RpcError(
        'internal',
        RcStickers.onlineAssetUnavailable({ reason: error instanceof Error ? error.message : String(error) }),
        {
          code: 'ONLINE_ASSET_UNAVAILABLE',
          path: asset.path,
        },
      );
    }
    this.#verified.add(key);
    return file;
  }
}

async function sizeOf(file: string): Promise<number> {
  const stat = await fs.stat(file).catch(() => null);
  return stat?.isFile() ? stat.size : -1;
}

async function isFile(file: string): Promise<boolean> {
  return (await sizeOf(file)) >= 0;
}
