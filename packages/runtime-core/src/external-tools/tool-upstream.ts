import type { ToolUpstream } from './tool-manifests.ts';

/**
 * 查上游最新的稳定版（架构设计 §12.9「自动更新」）：读 GitHub 的最新发布接口，取这个平台的发布文件与发布里的 sha256 清单
 * （yt-dlp 的 `SHA2-256SUMS`），交出版本、文件名、大小与 sha256。
 *
 * - 只认稳定版：接口说是草稿或预发布、版本号不合清单的格式时不认。
 * - sha256 取自清单文件；接口给了这个文件的摘要（`digest: sha256:…`）时两者要一致，不一致时不认。
 * - 地址只认 `https://github.com/` 下的发布文件；清单文件最多读 256 KiB。每个请求 30 秒超时。
 * - 不带任何用户信息：User-Agent 只写 BaoCut。
 */

export interface UpstreamAsset {
  version: string;
  fileName: string;
  size: number;
  sha256: string;
}

export interface UpstreamOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const TIMEOUT_MS = 30_000;
const CHECKSUMS_MAX_BYTES = 256 * 1024;
const HEADERS = { accept: 'application/vnd.github+json', 'user-agent': 'BaoCut', 'x-github-api-version': '2022-11-28' };

interface ReleaseAsset {
  name?: unknown;
  size?: unknown;
  browser_download_url?: unknown;
  digest?: unknown;
}

export async function latestUpstreamAsset(upstream: ToolUpstream, fileName: string, options: UpstreamOptions = {}): Promise<UpstreamAsset> {
  const get = (url: string) => {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    return (options.fetch ?? fetch)(url, { headers: HEADERS, redirect: 'follow', signal });
  };
  const response = await get(upstream.latestApi);
  if (!response.ok) throw new Error(`The release API answered HTTP ${response.status}`);
  const release = (await response.json()) as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };
  const version = typeof release.tag_name === 'string' ? release.tag_name : '';
  if (release.draft === true || release.prerelease === true) throw new Error(`The latest release ${version} is not a stable release`);
  if (!upstream.versionPattern.test(version)) throw new Error(`The latest release tag ${JSON.stringify(version)} is not a version`);
  const assets = Array.isArray(release.assets) ? (release.assets as ReleaseAsset[]) : [];
  const asset = assets.find((a) => a.name === fileName);
  if (!asset) throw new Error(`Release ${version} has no ${fileName}`);
  const size = asset.size;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) throw new Error(`Release ${version} gives no size for ${fileName}`);
  const list = assets.find((a) => a.name === upstream.checksums);
  const listUrl = list ? githubFileUrl(list.browser_download_url) : null;
  if (!listUrl) throw new Error(`Release ${version} has no ${upstream.checksums}`);
  const sums = await get(listUrl);
  if (!sums.ok) throw new Error(`Fetching ${upstream.checksums} answered HTTP ${sums.status}`);
  const text = await readLimited(sums, CHECKSUMS_MAX_BYTES);
  const sha256 = parseChecksums(text).get(fileName);
  if (!sha256) throw new Error(`${upstream.checksums} of release ${version} does not list ${fileName}`);
  const digest = typeof asset.digest === 'string' ? /^sha256:([0-9a-f]{64})$/i.exec(asset.digest)?.[1]?.toLowerCase() : undefined;
  if (digest && digest !== sha256) throw new Error(`The release API and ${upstream.checksums} disagree on the sha256 of ${fileName}`);
  return { version, fileName, size, sha256 };
}

/** `sha256sum` 的输出：每行 `<64 位十六进制>  <文件名>`（二进制模式的 `*` 去掉）。 */
export function parseChecksums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (match) map.set(match[2]!, match[1]!.toLowerCase());
  }
  return map;
}

function githubFileUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

async function readLimited(response: Response, max: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new Error(`The checksum file is larger than ${max} bytes`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > max) throw new Error(`The checksum file is larger than ${max} bytes`);
  return buffer.toString('utf8');
}
