/**
 * 安装包的 CDN 镜像：`https://baocut.com/releases/download/<tag>/<文件>` 与 GitHub Releases 同样的路径，文件放在 R2。
 *
 * - 读（`serveMirror`）：R2 里有就直接给，支持 `Range`（断点续传）、`HEAD` 与 `If-None-Match` / `If-Range`；
 *   没有（还没复制过来、已经清掉、没绑 R2）就 302 到 GitHub 上的同名文件，所以指向这里的地址永远可用。
 * - 写（`mirrorReleases`，Worker 的定时任务）：读最近几个 Release，把桌面安装包、ZIP、DMG 与独立 CLI 包复制进 R2，
 *   只留最近 `KEEP_RELEASES` 个 Release 的文件。复制按 GitHub 给的大小与 sha256（`digest`）由 R2 校验，传一半不会留下对象。
 *
 * 文件内容不可变（同一 tag 下的文件名带版本与构建号，发布后不再替换），所以响应可以长期缓存。应用自己再核对清单里的
 * 大小与 sha256，镜像出错也装不上错的包。
 */

import { GITHUB_DOWNLOAD_PREFIX, MIRROR_DOWNLOAD_PREFIX, RELEASES_API_URL, TAG } from './release.ts';

export const MIRROR_PATH = '/releases/download/';
/** 留几个 Release 的文件：最新一个（Windows 的文件晚于 macOS 追加），加上一个还没被它完全取代的。 */
export const KEEP_RELEASES = 2;
/** 一次定时任务最多花多久开始新的复制（毫秒）；定时任务的墙钟上限是 15 分钟，剩下的留给最后一个文件。 */
export const COPY_BUDGET_MS = 8 * 60 * 1000;
/** 镜像的文件：桌面安装包与 ZIP（`BaoCut-…`）、独立 CLI 包（`BaoCut-CLI-…`）。版本与构建号必须与 tag 一致。 */
const FILE = /^BaoCut(?:-CLI)?-(\d{1,4}\.\d{1,4}\.\d{1,4})-build\.(\d{1,7})-[A-Za-z0-9_.-]+\.(?:zip|dmg|exe)$/;
const CONTENT_TYPES: Record<string, string> = {
  zip: 'application/zip',
  dmg: 'application/x-apple-diskimage',
  exe: 'application/vnd.microsoft.portable-executable',
};

// ---- 只用到的 R2 接口（Workers 的类型不进依赖，与 worker.ts 的做法一致） ----

export interface MirrorObject {
  key: string;
  size: number;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
}

export interface MirrorObjectBody extends MirrorObject {
  body: ReadableStream<Uint8Array>;
}

export interface MirrorBucket {
  head(key: string): Promise<MirrorObject | null>;
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<MirrorObjectBody | null>;
  put(
    key: string,
    value: ReadableStream<Uint8Array>,
    options?: { httpMetadata?: { contentType?: string }; sha256?: string },
  ): Promise<MirrorObject | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { cursor?: string; limit?: number }): Promise<{ objects: MirrorObject[]; truncated: boolean; cursor?: string }>;
}

// ---- 地址 ----

/** 一个镜像文件：tag、文件名与 R2 里的键（`<tag>/<文件>`）。 */
export interface MirrorFile {
  tag: string;
  file: string;
  key: string;
}

/** tag 与文件名合不合镜像的规则：tag 是 `baocut-v<版本>-build.<构建号>`，文件名带同一个版本与构建号。 */
export function mirrorFile(tag: string, file: string): MirrorFile | null {
  const [, version, build] = TAG.exec(tag) ?? [];
  const [, fileVersion, fileBuild] = FILE.exec(file) ?? [];
  if (!version || version !== fileVersion || build !== fileBuild) return null;
  return { tag, file, key: `${tag}/${file}` };
}

/** `/releases/download/<tag>/<文件>` → 镜像文件；别的路径为 null。 */
export function parseMirrorPath(pathname: string): MirrorFile | null {
  if (!pathname.startsWith(MIRROR_PATH)) return null;
  const parts = pathname.slice(MIRROR_PATH.length).split('/');
  if (parts.length !== 2) return null;
  try {
    return mirrorFile(decodeURIComponent(parts[0]!), decodeURIComponent(parts[1]!));
  } catch {
    return null;
  }
}

export function githubDownloadUrl(tag: string, file: string): string {
  return `${GITHUB_DOWNLOAD_PREFIX}${tag}/${file}`;
}

export function mirrorDownloadUrl(tag: string, file: string): string {
  return `${MIRROR_DOWNLOAD_PREFIX}${tag}/${file}`;
}

// ---- 读 ----

type ByteRange = { offset: number; length: number };

/**
 * 解析单段的 `Range: bytes=…`（`a-b`、`a-`、`-n`）。没有或不是单段的 bytes 范围返回 null（给整个文件）；
 * 起点超出文件返回 'unsatisfiable'。
 */
export function parseRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  if (!match) return null;
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return null;
  if (first === '') {
    const suffix = Number(last);
    if (suffix === 0) return 'unsatisfiable';
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const offset = Number(first);
  if (offset >= size) return 'unsatisfiable';
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (end < offset) return null;
  return { offset, length: end - offset + 1 };
}

function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag);
}

function fileHeaders(file: MirrorFile, object: MirrorObject): Headers {
  const extension = file.file.split('.').pop() ?? '';
  return new Headers({
    'Content-Type': object.httpMetadata?.contentType || CONTENT_TYPES[extension] || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${file.file}"`,
    'Accept-Ranges': 'bytes',
    ETag: object.httpEtag,
    'Last-Modified': object.uploaded.toUTCString(),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
}

/** 镜像的一个文件；R2 里没有时 302 到 GitHub。 */
export async function serveMirror(request: Request, bucket: MirrorBucket | undefined, file: MirrorFile): Promise<Response> {
  const fallback = () =>
    new Response(null, { status: 302, headers: { Location: githubDownloadUrl(file.tag, file.file), 'Cache-Control': 'no-store' } });
  if (!bucket) return fallback();
  let object: MirrorObject | null;
  try {
    object = await bucket.head(file.key);
  } catch (error) {
    console.warn({ event: 'mirror-read', key: file.key, error: String(error) });
    return fallback();
  }
  if (!object) return fallback();
  const headers = fileHeaders(file, object);
  if (etagMatches(request.headers.get('If-None-Match'), object.httpEtag)) return new Response(null, { status: 304, headers });

  // If-Range 对不上（文件换过）就给整个文件，免得客户端把两份内容拼在一起。
  const ifRange = request.headers.get('If-Range');
  const rangeAllowed = !ifRange || ifRange.trim() === object.httpEtag;
  const range = rangeAllowed ? parseRange(request.headers.get('Range'), object.size) : null;
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${object.size}`);
    return new Response(null, { status: 416, headers });
  }
  const length = range ? range.length : object.size;
  headers.set('Content-Length', String(length));
  if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
  const status = range ? 206 : 200;
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  try {
    const body = await bucket.get(file.key, range ? { range } : undefined);
    if (!body) return fallback();
    return new Response(body.body, { status, headers });
  } catch (error) {
    console.warn({ event: 'mirror-read', key: file.key, error: String(error) });
    return fallback();
  }
}

// ---- 写 ----

/** 要镜像的一个 GitHub 文件。 */
export interface ReleaseAsset extends MirrorFile {
  url: string;
  size: number;
  /** GitHub 给的 sha256（十六进制小写）；老的 Release 没有时为 null。 */
  sha256: string | null;
}

export interface MirrorRelease {
  tag: string;
  build: number;
  assets: ReleaseAsset[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 从 GitHub「列出 Release」的响应里挑出要镜像的：已发布（非草稿、非预发布）、tag 合规的，按构建号从新到旧取前
 * `KEEP_RELEASES` 个；每个只要已传完、地址就是本仓库这个 tag 下同名文件的安装包。
 */
export function mirrorReleasesFrom(raw: unknown, keep = KEEP_RELEASES): MirrorRelease[] {
  if (!Array.isArray(raw)) return [];
  const releases: MirrorRelease[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || entry.draft !== false || entry.prerelease !== false) continue;
    const { tag_name: tag, assets } = entry;
    if (typeof tag !== 'string' || !Array.isArray(assets)) continue;
    const [, , build] = TAG.exec(tag) ?? [];
    if (!build) continue;
    const files: ReleaseAsset[] = [];
    for (const asset of assets) {
      if (!isRecord(asset) || asset.state !== 'uploaded') continue;
      const { name, size, browser_download_url: url, digest } = asset;
      if (typeof name !== 'string' || typeof url !== 'string' || typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) continue;
      const file = mirrorFile(tag, name);
      // 仓库地址在不同地方大小写不同（`JimLiu/baocut`），只比较小写。
      if (!file || url.toLowerCase() !== githubDownloadUrl(tag, name).toLowerCase()) continue;
      const sha256 = typeof digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(digest) ? digest.slice('sha256:'.length).toLowerCase() : null;
      files.push({ ...file, url, size, sha256 });
    }
    releases.push({ tag, build: Number(build), assets: files });
  }
  return releases.sort((a, b) => b.build - a.build).slice(0, keep);
}

export interface MirrorDeps {
  bucket: MirrorBucket;
  fetch: typeof fetch;
  githubToken?: string;
  now(): number;
  /** 把响应体包成已知长度的流（Workers 的 `FixedLengthStream`），R2 的 put 要知道长度。 */
  fixedLength(body: ReadableStream<Uint8Array>, size: number): ReadableStream<Uint8Array>;
}

export interface MirrorSummary {
  releases: string[];
  copied: string[];
  present: number;
  deferred: string[];
  failed: { key: string; error: string }[];
  deleted: string[];
}

async function listAll(bucket: MirrorBucket): Promise<MirrorObject[]> {
  const objects: MirrorObject[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list(cursor ? { cursor, limit: 1000 } : { limit: 1000 });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

async function copyAsset(deps: MirrorDeps, asset: ReleaseAsset): Promise<void> {
  const response = await deps.fetch(asset.url, { headers: { 'User-Agent': 'baocut-portal' }, redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const length = Number(response.headers.get('Content-Length'));
  if (length !== asset.size) {
    await response.body.cancel();
    throw new Error(`length ${length} != ${asset.size}`);
  }
  const extension = asset.file.split('.').pop() ?? '';
  const stored = await deps.bucket.put(asset.key, deps.fixedLength(response.body, asset.size), {
    httpMetadata: { contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream' },
    ...(asset.sha256 ? { sha256: asset.sha256 } : {}),
  });
  if (!stored || stored.size !== asset.size) throw new Error('stored size differs');
}

/**
 * 定时任务：把最近的 Release 复制进 R2，删掉更早的。GitHub 读不到时什么都不删。复制失败的文件下次再试，期间读它的人被带到 GitHub。
 */
export async function mirrorReleases(deps: MirrorDeps): Promise<MirrorSummary> {
  const started = deps.now();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'baocut-portal',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (deps.githubToken) headers.Authorization = `Bearer ${deps.githubToken}`;
  const response = await deps.fetch(RELEASES_API_URL, { headers });
  if (!response.ok) throw new Error(`GitHub releases: HTTP ${response.status}`);
  const releases = mirrorReleasesFrom(await response.json());
  const summary: MirrorSummary = { releases: releases.map((r) => r.tag), copied: [], present: 0, deferred: [], failed: [], deleted: [] };
  if (releases.length === 0) return summary;

  for (const asset of releases.flatMap((release) => release.assets)) {
    const existing = await deps.bucket.head(asset.key);
    if (existing && existing.size === asset.size) {
      summary.present += 1;
      continue;
    }
    if (deps.now() - started > COPY_BUDGET_MS) {
      summary.deferred.push(asset.key);
      continue;
    }
    try {
      await copyAsset(deps, asset);
      summary.copied.push(asset.key);
    } catch (error) {
      summary.failed.push({ key: asset.key, error: String(error) });
    }
  }

  const kept = new Set(summary.releases);
  const stale = (await listAll(deps.bucket)).map((object) => object.key).filter((key) => !kept.has(key.split('/')[0] ?? ''));
  for (let i = 0; i < stale.length; i += 1000) await deps.bucket.delete(stale.slice(i, i + 1000));
  summary.deleted = stale;
  return summary;
}
