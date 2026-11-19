/**
 * baocut.com 的 Worker。静态页面与资源在 dist/（`npm run build`），这里只接管 wrangler.jsonc 里 run_worker_first 列出的路径：
 *
 * - `/`：没有选过语言时按 Accept-Language 把简体中文访客带到 `/zh-hans/`；选过的（cookie）照选的来。语言切换链接带 `?lang=`，在这里记进 cookie。
 * - 页面：把带 `data-release` 的元素换成最新版本的版本号、构建号、日期与发布说明链接，不用为每次发版重新部署。
 * - `/download/<下载项>`：302 到最新版本里对应的文件；`/download` 按访客的系统挑一个。
 * - `/api/release`：最新版本与各个下载地址的 JSON。
 * - `/releases/download/<tag>/<文件>`：安装包的镜像，R2 里有就给（支持断点续传），没有就 302 到 GitHub（mirror.ts）。
 *   定时任务（wrangler.jsonc 的 `triggers.crons`）把最近的 Release 复制进 R2。
 *
 * 最新版本从 GitHub Releases 读（规则见 release.ts）。访客的请求从不等 GitHub：依次用本实例内存里的、本机房缓存里的、
 * 构建时的快照（dist/release.json），拿到的超过 5 分钟就在响应之后到后台重取一次。GitHub 限流或出错时继续用手上这份。
 * 设了 `GITHUB_TOKEN`（secret）就带上它，额度从每个出口 IP 每小时 60 次变成这个 token 的 5000 次。
 */

import {
  FEED_IDS,
  RELEASES_API_URL,
  RELEASES_URL,
  downloadUrl,
  formatReleaseDate,
  headlineRelease,
  isDownloadId,
  newerReleases,
  parseFeed,
  parseReleases,
  preferredDownload,
  releasePageUrl,
  releaseSummary,
  type FeedId,
  type ReleaseSet,
} from './release.ts';
import { mirrorReleases, parseMirrorPath, serveMirror, type MirrorBucket } from './mirror.ts';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** 可选的 GitHub token（`wrangler secret put GITHUB_TOKEN`），只用来读公开仓库的 Release 列表。 */
  GITHUB_TOKEN?: string;
  /** 安装包镜像的 R2 桶（`baocut-portal-releases`）。没绑时镜像地址一律跳到 GitHub。 */
  RELEASES?: MirrorBucket;
}

interface Context {
  waitUntil(promise: Promise<unknown>): void;
}

interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

interface ElementHandle {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  setInnerContent(content: string): void;
}

interface HtmlRewriter {
  on(selector: string, handlers: { element(element: ElementHandle): void }): HtmlRewriter;
  transform(response: Response): Response;
}

const CANONICAL_HOST = 'baocut.com';
const LANGUAGE_COOKIE = 'baocut_lang';
const ZH_HANS_PATH = '/zh-hans/';
/** cookie 与 ?lang= 接受的值：页面 `<html lang>` 的小写。 */
const LANGUAGES = ['en', 'zh-hans'];
const RELEASE_TTL_MS = 5 * 60 * 1000;
const GITHUB_TIMEOUT_MS = 5000;
/** 本机房缓存里存的是整理好的 `ReleaseSet`（几百字节），不是 GitHub 的原始响应：新实例不用再解析上百 KB 的 JSON。 */
const RELEASE_CACHE_PATH = '/_cache/releases';
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless/i;

interface CachedReleases {
  /** 这份数据从 GitHub 取到（或上次尝试取）的时间，毫秒。 */
  at: number;
  releases: ReleaseSet;
}

let memory: CachedReleases | null = null;
/** 本实例上一次开始重取的时间。只由发起它的请求在 waitUntil 里等，promise 不跨请求共享（Workers 不允许跨请求的 I/O）。 */
let refreshStartedAt = 0;

/** 构建时写进 dist/release.json 的更新源快照：`{ [FeedId]: 原始更新源 }`。 */
async function snapshotReleases(env: Env, origin: string): Promise<ReleaseSet> {
  try {
    const response = await env.ASSETS.fetch(new Request(`${origin}/release.json`));
    if (!response.ok) return {};
    const raw = (await response.json()) as Record<string, unknown>;
    const releases: ReleaseSet = {};
    for (const id of FEED_IDS) {
      const release = parseFeed(raw[id]);
      if (release) releases[id] = release;
    }
    return releases;
  } catch {
    return {};
  }
}

/** workers.dev 与 Node 里没有可用的机房缓存，只靠内存。 */
function edgeCache(): EdgeCache | null {
  return (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default ?? null;
}

async function readEdgeCache(origin: string): Promise<CachedReleases | null> {
  try {
    const response = await edgeCache()?.match(new Request(`${origin}${RELEASE_CACHE_PATH}`));
    if (!response) return null;
    const cached = (await response.json()) as Partial<CachedReleases> | null;
    if (typeof cached?.at !== 'number' || typeof cached.releases !== 'object' || !cached.releases) return null;
    return { at: cached.at, releases: cached.releases };
  } catch {
    return null;
  }
}

/**
 * 取一次 GitHub 的 Release 列表。每次的结果记一条 `github-releases` 日志（Workers Logs 与 `wrangler tail` 里看得到），
 * 用来确认 token 是否生效（`limit` 为 5000 是带上了，60 是没带上）和查发版后网站为什么没跟上。日志里不放 token。
 */
async function githubReleases(env: Env): Promise<ReleaseSet | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'baocut-portal',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const log = { event: 'github-releases', token: Boolean(env.GITHUB_TOKEN) };
  try {
    const response = await fetch(RELEASES_API_URL, { headers, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) });
    const rate = (name: string) => (response.headers.has(name) ? Number(response.headers.get(name)) : null);
    const status = { ...log, status: response.status, limit: rate('X-RateLimit-Limit'), remaining: rate('X-RateLimit-Remaining') };
    if (!response.ok) {
      console.warn(status);
      return null;
    }
    const releases = parseReleases(await response.json());
    console.log({ ...status, builds: Object.fromEntries(FEED_IDS.map((id) => [id, releases[id]?.build ?? null])) });
    return releases;
  } catch (error) {
    console.warn({ ...log, error: String(error) });
    return null;
  }
}

/** 重取一次，写进内存与机房缓存。失败时手上这份照用，同样等 5 分钟再试，不在 GitHub 出错或限流时每个请求都去敲。 */
async function refreshReleases(env: Env, origin: string, current: ReleaseSet | null): Promise<void> {
  const [snapshot, live] = await Promise.all([snapshotReleases(env, origin), githubReleases(env)]);
  const at = Date.now();
  if (!live) {
    memory = { at, releases: newerReleases(snapshot, current ?? {}) };
    return;
  }
  memory = { at, releases: newerReleases(snapshot, live) };
  try {
    // 过期由 `at` 判断；缓存头只决定机房留多久，留长一点，GitHub 取不到时别的实例还有上一份可用。
    await edgeCache()?.put(
      new Request(`${origin}${RELEASE_CACHE_PATH}`),
      new Response(JSON.stringify(memory), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
      }),
    );
  } catch {
    // 机房缓存写不进去只是少一层共享，内存里的照用。
  }
}

/** 当前最新的一组发布。立即返回手上最新的一份，过期了在响应之后到后台重取，不让访客等 GitHub。 */
async function latestReleases(env: Env, ctx: Context, origin: string): Promise<ReleaseSet> {
  const now = Date.now();
  if (memory && now - memory.at < RELEASE_TTL_MS) return memory.releases;
  const cached = await readEdgeCache(origin);
  if (cached && (!memory || cached.at > memory.at)) memory = cached;
  if (memory && now - memory.at < RELEASE_TTL_MS) return memory.releases;
  const current = memory?.releases ?? null;
  if (now - refreshStartedAt > GITHUB_TIMEOUT_MS * 2) {
    refreshStartedAt = now;
    ctx.waitUntil(refreshReleases(env, origin, current));
  }
  return current ?? snapshotReleases(env, origin);
}

function redirect(location: string, status = 302, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { Location: location, 'Cache-Control': 'no-store', ...headers } });
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

/** Accept-Language 里权重最高的语言是不是简体中文（`zh`、`zh-Hans`、`zh-CN`、`zh-SG`、`zh-MY`）。繁体与其他语言留在英文页。 */
export function prefersSimplifiedChinese(header: string | null): boolean {
  const ranked = (header ?? '')
    .split(',')
    .map((entry, index) => {
      const [tag = '', ...params] = entry.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter((entry) => entry.tag && entry.tag !== '*' && Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  const top = ranked[0]?.tag;
  if (!top) return false;
  return top === 'zh' || /^zh-(hans|cn|sg|my)(-|$)/.test(top);
}

async function servePage(env: Env, ctx: Context, url: URL): Promise<Response> {
  // 带条件头取资源会拿到没有正文的 304；页面正文要按最新版本改写，统一取完整的一份。
  const asset = await env.ASSETS.fetch(new Request(url.toString(), { headers: { Accept: 'text/html' } }));
  if (!asset.ok || !(asset.headers.get('Content-Type') ?? '').includes('text/html')) return asset;
  const releases = await latestReleases(env, ctx, url.origin);
  const headline = headlineRelease(releases);
  const Rewriter = (globalThis as unknown as { HTMLRewriter: new () => HtmlRewriter }).HTMLRewriter;
  const rewritten = new Rewriter()
    .on('[data-release]', {
      element(element) {
        const feed = element.getAttribute('data-release-feed');
        const release = feed && (FEED_IDS as readonly string[]).includes(feed) ? releases[feed as FeedId] : headline;
        if (!release) return;
        switch (element.getAttribute('data-release')) {
          case 'version':
            element.setInnerContent(release.version);
            break;
          case 'build':
            element.setInnerContent(String(release.build));
            break;
          case 'date':
            element.setInnerContent(formatReleaseDate(release.date, element.getAttribute('data-locale') ?? 'en'));
            element.setAttribute('datetime', release.date);
            break;
          case 'notes':
            element.setAttribute('href', releasePageUrl(release));
            break;
        }
      },
    })
    .transform(asset);
  const headers = new Headers(rewritten.headers);
  // 正文随版本变，原资源的 ETag 不再对应它。
  headers.delete('ETag');
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (url.pathname === '/' || url.pathname === '/index.html') headers.set('Vary', 'Accept-Language, Cookie');
  return new Response(rewritten.body, { status: rewritten.status, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === `www.${CANONICAL_HOST}`) {
      return redirect(`https://${CANONICAL_HOST}${url.pathname}${url.search}`, 301, { 'Cache-Control': 'public, max-age=86400' });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    if (url.pathname === '/api/release') {
      const summary = releaseSummary(await latestReleases(env, ctx, url.origin));
      return new Response(JSON.stringify(summary), {
        status: summary ? 200 : 503,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (url.pathname === '/download' || url.pathname === '/download/') {
      const id = preferredDownload(request.headers.get('User-Agent') ?? '', request.headers.get('Sec-CH-UA-Platform') ?? '');
      return redirect(id ? `/download/${id}` : '/#download');
    }

    if (url.pathname.startsWith('/releases/download/')) {
      const file = parseMirrorPath(url.pathname);
      if (!file) return env.ASSETS.fetch(new Request(`${url.origin}/404.html`)).then(notFound);
      return serveMirror(request, env.RELEASES, file);
    }

    if (url.pathname.startsWith('/download/')) {
      const id = url.pathname.slice('/download/'.length);
      if (!isDownloadId(id)) return env.ASSETS.fetch(new Request(`${url.origin}/404.html`)).then(notFound);
      const location = downloadUrl(await latestReleases(env, ctx, url.origin), id);
      return redirect(location ?? RELEASES_URL);
    }

    // 语言切换的链接带 ?lang=：记进 cookie，再回到不带参数的地址。
    const picked = url.searchParams.get('lang');
    if (picked !== null) {
      const clean = new URL(url);
      clean.searchParams.delete('lang');
      const location = `${clean.pathname}${clean.search}`;
      if (!LANGUAGES.includes(picked)) return redirect(location);
      return redirect(location, 302, {
        'Set-Cookie': `${LANGUAGE_COOKIE}=${picked}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
      });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const chosen = readCookie(request, LANGUAGE_COOKIE);
      const wantsChinese =
        chosen === 'zh-hans' ||
        (chosen !== 'en' &&
          !BOT.test(request.headers.get('User-Agent') ?? '') &&
          prefersSimplifiedChinese(request.headers.get('Accept-Language')));
      if (wantsChinese) return redirect(`${ZH_HANS_PATH}${url.search}`, 302, { Vary: 'Accept-Language, Cookie' });
    }

    return servePage(env, ctx, url);
  },

  /** 定时任务：把最近的 Release 复制进镜像。结果记一条 `mirror` 日志。 */
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const bucket = env.RELEASES;
    if (!bucket) return;
    const Fixed = (globalThis as unknown as { FixedLengthStream?: new (length: number) => TransformStream<Uint8Array, Uint8Array> })
      .FixedLengthStream;
    await mirrorReleases({
      bucket,
      fetch: (input, init) => fetch(input, init),
      ...(env.GITHUB_TOKEN ? { githubToken: env.GITHUB_TOKEN } : {}),
      now: () => Date.now(),
      fixedLength(body, size) {
        if (!Fixed) return body;
        const stream = new Fixed(size);
        void body.pipeTo(stream.writable).catch(() => undefined);
        return stream.readable;
      },
    }).then(
      (summary) => console.log({ event: 'mirror', ...summary }),
      (error: unknown) => console.warn({ event: 'mirror', error: String(error) }),
    );
  },
};

function notFound(page: Response): Response {
  return new Response(page.body, { status: 404, headers: page.headers });
}
