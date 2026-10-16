import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';

/**
 * 界面要存下来的地址：只收这个 Runtime 媒体通道签发的句柄（`<Runtime 的 http 来源>/media/<句柄>/<文件名>`，架构设计 §4.5），
 * 主进程不替渲染进程去取别处的地址。查询串（例如浏览器下载用的 `download=1`）不带过去。不合要求时 null。
 */
export function runtimeMediaUrl(value: unknown, endpoint: string | null): URL | null {
  if (typeof value !== 'string' || !endpoint) return null;
  let url: URL;
  let base: URL;
  try {
    url = new URL(value);
    base = new URL(endpoint.replace(/^ws(s?):/, 'http$1:'));
  } catch {
    return null;
  }
  if (url.origin !== base.origin || !/^\/media\/[A-Za-z0-9_-]+(?:\/[^/]*)?$/.test(url.pathname)) return null;
  url.search = '';
  url.hash = '';
  return url;
}

/**
 * 把地址的内容流式写进 `file`，不整份读进内存（视频可能有几个 GB）。先写同目录的临时文件，写完再换名：
 * 中途失败时删掉临时文件，用户在对话框里同意覆盖的原文件保持原样。取不到（例如句柄过期）时抛 `HTTP <状态码>`。
 */
export async function downloadToFile(url: URL, file: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(url);
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}-${Date.now()}.part`);
  try {
    await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), fs.createWriteStream(temp, { flags: 'wx' }));
    await fsp.rename(temp, file);
  } catch (error) {
    await fsp.rm(temp, { force: true });
    throw error;
  }
}
