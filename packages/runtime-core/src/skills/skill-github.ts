import fsp from 'node:fs/promises';
import path from 'node:path';
import { RpcError, SKILL_FILE, SKILL_LIMITS, type Localized } from '@baocut/protocol';
import { RcSkills } from '@baocut/protocol/messages/runtime-core';

/**
 * 从 GitHub 取一个 skill 目录（架构设计 §12.9）。只用 GitHub 的公开接口：
 *
 * 1. 地址里没写 `ref` 时取仓库的默认分支；把 `ref` 解析成提交 sha（之后都按这个提交取，导入的内容与记下的提交一致）；
 * 2. 从根树沿子目录一级一级找到目标目录的树，再递归列出它下面的条目（只列这个目录，不列整个仓库）；
 * 3. 先查条目：根目录要有 `SKILL.md`，不得有符号链接，文件数与总大小不超过上限，点开头的条目与子模块不取；都过了才下载；
 * 4. 按提交从 raw 地址逐个下载文件，按清单里的大小设上限，写进调用方给的暂存目录。
 *
 * 不执行任何下载的内容。没有重试：失败如实报告，用户再导入一次即可。每个请求有超时，整次导入另有总时限。
 */

export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com';
const ALLOWED_HOSTS = new Set(['api.github.com', 'raw.githubusercontent.com', 'codeload.github.com']);
/** 一次 JSON 回应（仓库信息、一级树、递归树）的上限。 */
const JSON_MAX_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export interface GithubSkillRef {
  owner: string;
  repo: string;
  /** 地址里写的分支、标签或提交；没写时 null（用默认分支）。 */
  ref: string | null;
  /** 仓库里的子目录，`/` 分隔；仓库根为空串。 */
  path: string;
  /** 规范化的地址。 */
  url: string;
}

export interface GithubFetchOptions {
  fetch?: typeof fetch;
  /** 测试用：换掉接口与 raw 的基址。 */
  apiBase?: string;
  rawBase?: string;
  signal?: AbortSignal;
}

function urlInvalid(message: Localized, input: string): RpcError {
  return new RpcError('invalid-request', message, { code: 'SKILL_GITHUB_URL_INVALID', url: input });
}

/**
 * 认 `owner/repo`、`https://github.com/<owner>/<repo>`（可带 `.git`、末尾斜杠、查询与锚点）与
 * `https://github.com/<owner>/<repo>/tree/<ref>/<子目录>`。`ref` 取 `tree/` 之后的一段：名字里带 `/` 的分支要换成提交 sha 或标签再导入。
 */
export function parseGithubSkillUrl(input: string): GithubSkillRef {
  const raw = input.trim();
  if (!raw) throw urlInvalid(RcSkills.urlEmpty(), input);
  let rest = raw;
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i.exec(raw);
  if (url) rest = url[1]!;
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^[^/\s]+\.[a-z]{2,}\//i.test(raw)) throw urlInvalid(RcSkills.urlNotGithub(), input);
  const parts = rest
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .split('/');
  if (parts.length < 2 || !parts[0] || !parts[1]) throw urlInvalid(RcSkills.urlNeedsOwnerRepo(), input);
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) throw urlInvalid(RcSkills.urlBadChars(), input);
  let ref: string | null = null;
  let sub = '';
  if (parts.length > 2) {
    if (parts[2] !== 'tree' || !parts[3]) throw urlInvalid(RcSkills.urlUnsupportedForm(), input);
    let segments: string[];
    try {
      segments = parts.slice(3).map((seg) => decodeURIComponent(seg));
    } catch {
      throw urlInvalid(RcSkills.urlBadEncoding(), input);
    }
    if (segments.some((seg) => !seg || seg === '.' || seg === '..' || /[\\\u0000-\u001f]/.test(seg))) {
      throw urlInvalid(RcSkills.urlBadPath(), input);
    }
    ref = segments[0]!;
    sub = segments.slice(1).join('/');
  }
  const encoded = (s: string) => s.split('/').map(encodeURIComponent).join('/');
  return {
    owner,
    repo,
    ref,
    path: sub,
    url: `https://github.com/${owner}/${repo}${ref ? `/tree/${encoded(ref)}${sub ? `/${encoded(sub)}` : ''}` : ''}`,
  };
}

interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
}

/**
 * 把 `ref` 指的那个目录下载到 `staging`（必须已存在且为空）。返回实际用的 `ref` 与提交。
 * 内容不合规（缺 `SKILL.md`、有符号链接）时 `SKILL_INVALID`，超过上限时 `SKILL_TOO_LARGE`，都在下载文件之前。
 */
export async function fetchGithubSkill(
  target: GithubSkillRef,
  staging: string,
  options: GithubFetchOptions = {},
): Promise<{ ref: string; commit: string; files: number; bytes: number }> {
  const http = new GithubHttp(options);
  const repoPath = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
  const where = `${target.owner}/${target.repo}`;
  let ref = target.ref;
  if (!ref) {
    const info = (await http.json(`${repoPath}`, RcSkills.whatRepo({ where }))) as { default_branch?: unknown };
    if (typeof info.default_branch !== 'string' || !info.default_branch) throw http.network(RcSkills.noDefaultBranch({ where }));
    ref = info.default_branch;
  }
  const commit = (
    await http.text(`${repoPath}/commits/${encodeURIComponent(ref)}`, RcSkills.whatRef({ where, ref }), { Accept: 'application/vnd.github.sha' })
  ).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw http.network(RcSkills.noRefCommit({ where, ref }));

  // 沿子目录一级一级往下找，只列需要的那几层。
  let treeSha = commit;
  const segments = target.path ? target.path.split('/') : [];
  for (let i = 0; i < segments.length; i++) {
    const level = (await http.json(`${repoPath}/git/trees/${treeSha}`, RcSkills.whatTree({ where }))) as { tree?: TreeEntry[] };
    const next = (level.tree ?? []).find((e) => e.path === segments[i] && e.type === 'tree');
    if (!next) {
      throw new RpcError('not-found', RcSkills.folderNotInRef({ where, ref, folder: segments.slice(0, i + 1).join('/') }), {
        code: 'SKILL_SOURCE_NOT_FOUND',
        url: target.url,
      });
    }
    treeSha = next.sha;
  }
  const listing = (await http.json(`${repoPath}/git/trees/${treeSha}?recursive=1`, RcSkills.whatTree({ where }))) as {
    tree?: TreeEntry[];
    truncated?: boolean;
  };
  if (listing.truncated) {
    throw new RpcError('invalid-request', RcSkills.treeTruncated({ limit: SKILL_LIMITS.files }), {
      code: 'SKILL_TOO_LARGE',
      url: target.url,
      limit: { files: SKILL_LIMITS.files, bytes: SKILL_LIMITS.totalBytes },
    });
  }
  const blobs: { path: string; size: number }[] = [];
  const issues: Localized[] = [];
  for (const entry of listing.tree ?? []) {
    if (entry.path.split('/').some((seg) => seg.startsWith('.'))) continue;
    if (entry.type === 'blob' && entry.mode === '120000') issues.push(RcSkills.noSymlinks({ path: entry.path }));
    else if (entry.type === 'blob') {
      if (
        entry.path.length > SKILL_LIMITS.path ||
        entry.path.split('/').some((seg) => !seg || seg === '..' || /[\\\u0000-\u001f]/.test(seg))
      ) {
        issues.push(RcSkills.pathInvalid({ path: entry.path.slice(0, 80) }));
      } else {
        blobs.push({ path: entry.path, size: typeof entry.size === 'number' ? entry.size : 0 });
      }
    }
    // `tree` 是目录本身（递归列表里已经展开），`commit` 是子模块：都不取。
  }
  if (!blobs.some((b) => b.path === SKILL_FILE)) issues.push(RcSkills.folderRootMissingFile({ file: SKILL_FILE }));
  if (issues.length) {
    throw new RpcError('invalid-request', RcSkills.notImportable({ issue: issues[0]! }), {
      code: 'SKILL_INVALID',
      url: target.url,
      issues: issues.map((issue) => issue.text),
    });
  }
  const bytes = blobs.reduce((sum, b) => sum + b.size, 0);
  if (blobs.length > SKILL_LIMITS.files || bytes > SKILL_LIMITS.totalBytes) {
    throw new RpcError(
      'invalid-request',
      RcSkills.githubFolderTooLarge({ files: blobs.length, bytes, maxFiles: SKILL_LIMITS.files, maxBytes: SKILL_LIMITS.totalBytes }),
      {
        code: 'SKILL_TOO_LARGE',
        url: target.url,
        files: blobs.length,
        bytes,
        limit: { files: SKILL_LIMITS.files, bytes: SKILL_LIMITS.totalBytes },
      },
    );
  }

  let received = 0;
  for (const blob of blobs) {
    const repoFile = target.path ? `${target.path}/${blob.path}` : blob.path;
    const rawPath = `/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/${commit}/${repoFile.split('/').map(encodeURIComponent).join('/')}`;
    const data = await http.bytes(http.rawUrl(rawPath), blob.path, Math.min(blob.size, SKILL_LIMITS.totalBytes - received));
    received += data.byteLength;
    const dest = path.join(staging, ...blob.path.split('/'));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, data, { flag: 'wx' });
  }
  return { ref, commit, files: blobs.length, bytes: received };
}

/** 几个请求共用的部分：超时、上限、状态码换成错误码、重定向只认 GitHub 的主机。 */
class GithubHttp {
  readonly #fetch: typeof fetch;
  readonly #api: string;
  readonly #raw: string;
  readonly #signal: AbortSignal | undefined;

  constructor(options: GithubFetchOptions) {
    this.#fetch = options.fetch ?? fetch;
    this.#api = (options.apiBase ?? GITHUB_API_BASE).replace(/\/+$/, '');
    this.#raw = (options.rawBase ?? GITHUB_RAW_BASE).replace(/\/+$/, '');
    this.#signal = options.signal;
  }

  rawUrl(p: string): string {
    return `${this.#raw}${p}`;
  }

  network(message: Localized, extra: Record<string, unknown> = {}): RpcError {
    return new RpcError('conflict', message, { code: 'SKILL_GITHUB_NETWORK', ...extra });
  }

  async json(apiPath: string, what: Localized): Promise<unknown> {
    const text = await this.text(apiPath, what, { Accept: 'application/vnd.github+json' });
    try {
      return JSON.parse(text);
    } catch {
      throw this.network(RcSkills.githubNotJson({ what }));
    }
  }

  async text(apiPath: string, what: Localized, headers: Record<string, string>): Promise<string> {
    return Buffer.from(await this.bytes(`${this.#api}${apiPath}`, what, JSON_MAX_BYTES, headers)).toString('utf8');
  }

  async bytes(url: string, what: string | Localized, maxBytes: number, headers: Record<string, string> = {}): Promise<Uint8Array> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = this.#signal ? AbortSignal.any([this.#signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: { 'User-Agent': 'BaoCut', 'X-GitHub-Api-Version': '2022-11-28', ...headers },
        signal,
        redirect: 'follow',
      });
    } catch {
      throw this.network(timeout.aborted ? RcSkills.githubConnectTimeout({ what }) : RcSkills.githubUnreachable({ what }));
    }
    // 跟随了重定向（例如仓库改了名）时，最后的地址仍要在 GitHub 的主机上。
    if (response.url && response.redirected) {
      let host = '';
      try {
        host = new URL(response.url).hostname;
      } catch {
        // 地址不合法：按不认识的主机处理。
      }
      if (!ALLOWED_HOSTS.has(host)) {
        await response.body?.cancel().catch(() => {});
        throw this.network(RcSkills.githubRedirectedAway({ what }));
      }
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if ((response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(response.headers.get('x-ratelimit-reset'));
        throw new RpcError('conflict', RcSkills.githubRateLimited(), {
          code: 'SKILL_GITHUB_RATE_LIMITED',
          ...(Number.isFinite(reset) && reset > 0 ? { retryAt: new Date(reset * 1000).toISOString() } : {}),
        });
      }
      if (response.status === 404 || response.status === 422) {
        throw new RpcError('not-found', RcSkills.githubNotFound({ what }), {
          code: 'SKILL_SOURCE_NOT_FOUND',
          status: response.status,
        });
      }
      throw this.network(RcSkills.githubHttpStatus({ what, status: response.status }), { status: response.status });
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw tooLarge(what, maxBytes);
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      if (response.body) {
        for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
          received += chunk.byteLength;
          if (received > maxBytes) throw tooLarge(what, maxBytes);
          chunks.push(chunk);
        }
      }
    } catch (error) {
      if (error instanceof RpcError) throw error;
      throw this.network(timeout.aborted ? RcSkills.githubDownloadTimeout({ what }) : RcSkills.githubConnectionLost({ what }));
    }
    return Buffer.concat(chunks);
  }
}

function tooLarge(what: string | Localized, maxBytes: number): RpcError {
  return new RpcError('invalid-request', RcSkills.downloadTooLarge({ what, limit: maxBytes }), {
    code: 'SKILL_TOO_LARGE',
    limit: { files: SKILL_LIMITS.files, bytes: SKILL_LIMITS.totalBytes },
  });
}
