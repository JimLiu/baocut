import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { RpcError, type MediaHandle, type MediaPlayback } from '@baocut/protocol';
import type { Logger } from '@baocut/harness';
import { inspectFileContent } from './file-content.ts';
import { RcRuntime } from '@baocut/protocol/messages/runtime-core';

/**
 * 媒体通道（架构设计 §4.5、§5.6）：界面的 `<video>`、`<img>` 不能带令牌头，所以 Runtime 为单个文件
 * 发一个不可猜的受限句柄，句柄本身就是凭证。
 *
 * - 只能发给来源目录里的文件：两边都取真实路径后做前缀检查，符号链接逃不出去。
 * - 句柄有期限；每次使用顺延，长视频看到一半不会失效。
 * - 支持 HTTP Range（206/416）与 HEAD，播放器才能拖动。
 * - 日志里不写路径。
 */

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  srt: 'text/plain; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
  ass: 'text/plain; charset=utf-8',
  ssa: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  lottie: 'application/zip',
  pdf: 'application/pdf',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff2: 'font/woff2',
};

export function mimeTypeOf(fileName: string): string {
  return MIME_BY_EXT[path.extname(fileName).slice(1).toLowerCase()] ?? 'application/octet-stream';
}

/** 解析单段 `Range: bytes=…`。没有或看不懂返回 null（按整文件给）；越界返回 'unsatisfiable'。 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, from, to] = match;
  if (from === '' && to === '') return null;
  if (from === '') {
    const suffix = Number(to);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(from);
  if (start >= size) return 'unsatisfiable';
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (end < start) return 'unsatisfiable';
  return { start, end };
}

/** 取 `target` 的真实路径，并确认它在 `root` 之内、是普通文件。 */
export async function resolveInside(root: string, target: string): Promise<{ realPath: string; size: number }> {
  let rootReal: string;
  let realPath: string;
  try {
    rootReal = await fsp.realpath(root);
    realPath = await fsp.realpath(path.resolve(root, target));
  } catch {
    throw new RpcError('not-found', RcRuntime.fileNotFound());
  }
  const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  if (!realPath.startsWith(prefix)) throw new RpcError('forbidden', RcRuntime.onlyWorkingFolderFiles());
  const stat = await fsp.stat(realPath).catch(() => null);
  if (!stat?.isFile()) throw new RpcError('not-found', RcRuntime.notAFile());
  return { realPath, size: stat.size };
}

const SUBTITLE_EXTS = new Set(['srt', 'vtt', 'ass', 'ssa']);
const MAX_SUBTITLES = 50;

/** 去掉最后一个扩展名：`a.zh.srt` → `a.zh`。 */
function stem(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/**
 * 与 `target` 放在同一目录里的字幕文件。`relPath` 相对 `root`，用 `/` 分隔，可以直接再拿去取媒体地址。
 * 与视频同名的排前面：完全同名的（`a.srt`）最先，带标记的（`a.zh.srt`）其次，其余按文件名。
 */
export async function findSubtitles(
  root: string,
  target: string,
): Promise<{ relPath: string; fileName: string; matched: boolean; tag: string | null }[]> {
  const { realPath } = await resolveInside(root, target);
  const rootReal = await fsp.realpath(root);
  const dir = path.dirname(realPath);
  const relDir = path.relative(rootReal, dir).split(path.sep).filter(Boolean).join('/');
  const base = stem(path.basename(realPath)).toLowerCase();
  const names = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  return names
    .filter(
      (d) =>
        (d.isFile() || d.isSymbolicLink()) && !d.name.startsWith('.') && SUBTITLE_EXTS.has(path.extname(d.name).slice(1).toLowerCase()),
    )
    .map((d) => {
      const name = stem(d.name);
      const lower = name.toLowerCase();
      const matched = lower === base || lower.startsWith(`${base}.`);
      return {
        relPath: relDir ? `${relDir}/${d.name}` : d.name,
        fileName: d.name,
        matched,
        tag: matched && name.length > base.length ? name.slice(base.length + 1) : null,
      };
    })
    .sort((a, b) => rank(a) - rank(b) || a.fileName.localeCompare(b.fileName))
    .slice(0, MAX_SUBTITLES);
}

function rank(track: { matched: boolean; tag: string | null }): number {
  return !track.matched ? 2 : track.tag === null ? 0 : 1;
}

interface Grant {
  handle: MediaHandle;
  realPath: string;
  fileName: string;
  mimeType: string;
  expiresAt: number;
}

export interface MediaRegistryOptions {
  log: Logger;
  ttlMs?: number;
  /** 与网关相同的来源规则，用于 CORS（界面要用 fetch 读字幕与文档）。 */
  originAllowed: (origin: string | undefined) => boolean;
  maxGrants?: number;
}

export class MediaRegistry {
  readonly #log: Logger;
  readonly #ttlMs: number;
  readonly #maxGrants: number;
  readonly #originAllowed: (origin: string | undefined) => boolean;
  readonly #grants = new Map<string, Grant>();
  #baseUrl = '';

  constructor(options: MediaRegistryOptions) {
    this.#log = options.log.child('media');
    this.#ttlMs = options.ttlMs ?? 60 * 60 * 1000;
    this.#maxGrants = options.maxGrants ?? 4096;
    this.#originAllowed = options.originAllowed;
  }

  setBaseUrl(url: string): void {
    this.#baseUrl = url;
  }

  async issue(root: string, target: string): Promise<MediaHandle> {
    const { realPath, size } = await resolveInside(root, target);
    this.#prune();
    const id = crypto.randomBytes(24).toString('base64url');
    const fileName = path.basename(realPath);
    const content = await inspectFileContent(realPath, size);
    const expiresAt = Date.now() + this.#ttlMs;
    const handle: MediaHandle = {
      url: `${this.#baseUrl}/media/${id}/${encodeURIComponent(fileName)}`,
      mimeType: content.mimeType,
      contentKind: content.contentKind,
      ...(content.textEncoding ? { textEncoding: content.textEncoding } : {}),
      size,
      fileName,
      expiresAt: new Date(expiresAt).toISOString(),
    };
    this.#grants.set(id, { handle, realPath, fileName, mimeType: content.mimeType, expiresAt });
    return handle;
  }

  /** Only an existing grant may request playback; cache paths never cross the control channel. */
  async playback(
    url: string,
    prepare: (file: string) => Promise<{ status: 'pending'; retryAfterMs: number } | { status: 'ready'; root: string; file: string }>,
  ): Promise<MediaPlayback> {
    const base = new URL(this.#baseUrl || '/', 'http://localhost');
    let parsed: URL;
    try { parsed = new URL(url, base); } catch { throw new RpcError('not-found', RcRuntime.fileNotFound()); }
    const id = /^\/media\/([A-Za-z0-9_-]+)(?:\/[^/]*)?$/.exec(parsed.pathname)?.[1];
    const grant = parsed.origin === base.origin && id ? this.#grants.get(id) : undefined;
    if (!grant || grant.expiresAt <= Date.now()) throw new RpcError('not-found', RcRuntime.fileNotFound());
    const realPath = await fsp.realpath(grant.realPath).catch(() => null);
    if (realPath !== grant.realPath || !(await fsp.stat(realPath).catch(() => null))?.isFile()) {
      throw new RpcError('not-found', RcRuntime.fileNotFound());
    }
    grant.expiresAt = Date.now() + this.#ttlMs;
    if (!['video/webm', 'audio/webm'].includes(grant.mimeType)) return { status: 'ready', media: grant.handle };
    const result = await prepare(realPath);
    if (result.status === 'pending') return result;
    const media = await this.issue(result.root, result.file);
    return { status: 'ready', media: { ...media, fileName: grant.handle.fileName } };
  }

  /** 处理 `/media/<句柄>/<文件名>`。不是这个前缀返回 false。 */
  handle(request: IncomingMessage, response: ServerResponse): boolean {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const match = /^\/media\/([A-Za-z0-9_-]+)(?:\/[^/]*)?$/.exec(url.pathname);
    if (!match) return false;
    const origin = request.headers.origin;
    if (origin !== undefined && this.#originAllowed(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': 'Range' }).end();
      return true;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return true;
    }
    void this.#serve(match[1]!, request, response, url.searchParams.get('download') === '1').catch((error) => {
      this.#log.warn('Media request failed', { error: (error as Error).name });
      if (!response.headersSent) response.writeHead(500).end();
      else response.destroy();
    });
    return true;
  }

  async #serve(id: string, request: IncomingMessage, response: ServerResponse, download: boolean): Promise<void> {
    const grant = this.#grants.get(id);
    if (!grant || grant.expiresAt <= Date.now()) {
      if (grant) this.#grants.delete(id);
      response.writeHead(404).end();
      return;
    }
    // 发句柄之后路径上的某一段可能被换成了符号链接：再取一次真实路径，对不上就不给。
    const realPath = await fsp.realpath(grant.realPath).catch(() => null);
    const stat = realPath === grant.realPath ? await fsp.stat(realPath).catch(() => null) : null;
    if (!stat?.isFile()) {
      response.writeHead(404).end();
      return;
    }
    grant.expiresAt = Date.now() + this.#ttlMs;

    const size = stat.size;
    const headers: Record<string, string | number> = {
      'Content-Type': grant.mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-cache',
      'Last-Modified': stat.mtime.toUTCString(),
      'X-Content-Type-Options': 'nosniff',
      // 文件内容不当页面执行（例如 SVG 被直接打开）。
      'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      ...(download ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(grant.fileName).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())}` } : {}),
    };
    const range = parseRange(request.headers.range, size);
    if (range === 'unsatisfiable') {
      response.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : size - 1;
    const length = size === 0 ? 0 : end - start + 1;
    response.writeHead(range ? 206 : 200, {
      ...headers,
      'Content-Length': length,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    });
    if (request.method === 'HEAD' || length === 0) {
      response.end();
      return;
    }
    const stream = fs.createReadStream(grant.realPath, { start, end });
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  }

  #prune(): void {
    const now = Date.now();
    for (const [id, grant] of this.#grants) if (grant.expiresAt <= now) this.#grants.delete(id);
    // 超过上限时丢掉最早发的。
    while (this.#grants.size >= this.#maxGrants) {
      const oldest = this.#grants.keys().next().value;
      if (oldest === undefined) break;
      this.#grants.delete(oldest);
    }
  }
}
