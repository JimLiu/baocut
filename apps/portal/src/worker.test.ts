import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FEED_FILES, FEED_IDS } from './release.ts';
import worker, { prefersSimplifiedChinese } from './worker.ts';

describe('prefersSimplifiedChinese', () => {
  it('follows the highest-ranked language', () => {
    expect(prefersSimplifiedChinese('zh-CN,zh;q=0.9,en;q=0.8')).toBe(true);
    expect(prefersSimplifiedChinese('zh')).toBe(true);
    expect(prefersSimplifiedChinese('zh-Hans-CN')).toBe(true);
    expect(prefersSimplifiedChinese('en-US,en;q=0.9,zh-CN;q=0.8')).toBe(false);
    expect(prefersSimplifiedChinese('en;q=0.5,zh-CN;q=0.9')).toBe(true);
  });

  it('leaves Traditional Chinese, wildcards and missing headers on the default page', () => {
    expect(prefersSimplifiedChinese('zh-TW,zh;q=0.9')).toBe(false);
    expect(prefersSimplifiedChinese('zh-Hant')).toBe(false);
    expect(prefersSimplifiedChinese('*')).toBe(false);
    expect(prefersSimplifiedChinese(null)).toBe(false);
  });
});

describe('fetch', () => {
  const feeds = Object.fromEntries(
    FEED_IDS.map((id) => [id, JSON.parse(readFileSync(new URL(`../../desktop/releases/${FEED_FILES[id]}`, import.meta.url), 'utf8'))]),
  );
  const env = {
    ASSETS: {
      async fetch(request: Request) {
        const path = new URL(request.url).pathname;
        if (path === '/release.json') return Response.json(feeds);
        // 页面改写要用 Workers 的 HTMLRewriter，Node 里没有；这里只测路由，静态文件一律给纯文本。
        return new Response(path, { headers: { 'Content-Type': 'text/plain' } });
      },
    },
  };
  const ctx = { waitUntil() {} };
  const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`https://baocut.com${path}`, init), env, ctx);

  // GitHub 取不到时退回构建快照；这里让它失败，结果只取决于仓库里的更新源。
  beforeAll(() => vi.stubGlobal('fetch', async () => new Response(null, { status: 503 })));
  afterAll(() => vi.unstubAllGlobals());

  it('sends www to the apex domain', async () => {
    const response = await worker.fetch(new Request('https://www.baocut.com/zh-hans/?a=1'), env, ctx);
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('https://baocut.com/zh-hans/?a=1');
  });

  it('only answers GET and HEAD', async () => {
    expect((await call('/', { method: 'POST' })).status).toBe(405);
  });

  it('remembers a language picked through ?lang=', async () => {
    const response = await call('/?lang=zh-hans&ref=x');
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/?ref=x');
    expect(response.headers.get('Set-Cookie')).toMatch(/^baocut_lang=zh-hans; Path=\/;/);
    const unknown = await call('/?lang=fr');
    expect(unknown.headers.get('Location')).toBe('/');
    expect(unknown.headers.get('Set-Cookie')).toBeNull();
  });

  it('sends Simplified Chinese browsers to /zh-hans/ unless they picked English', async () => {
    const chinese = await call('/', { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
    expect(chinese.status).toBe(302);
    expect(chinese.headers.get('Location')).toBe('/zh-hans/');
    const picked = await call('/', { headers: { 'Accept-Language': 'zh-CN', Cookie: 'a=1; baocut_lang=en' } });
    expect(picked.status).not.toBe(302);
    const bot = await call('/', { headers: { 'Accept-Language': 'zh-CN', 'User-Agent': 'Googlebot/2.1' } });
    expect(bot.status).not.toBe(302);
  });

  it('redirects downloads to the release asset', async () => {
    const response = await call('/download/win-cuda-setup');
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toMatch(
      /^https:\/\/baocut\.com\/releases\/download\/baocut-v[\d.]+-build\.\d+\/BaoCut-[\d.]+-build\.\d+-win-x64-cuda-setup\.exe$/,
    );
    const pick = await call('/download', { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } });
    expect(pick.headers.get('Location')).toBe('/download/mac-dmg');
    expect((await call('/download/linux')).status).toBe(404);
  });

  it('serves the release summary', async () => {
    const response = await call('/api/release');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { downloads: Record<string, string> };
    expect(Object.keys(body.downloads)).toHaveLength(8);
  });
});

describe('release refresh', () => {
  const feeds = Object.fromEntries(
    FEED_IDS.map((id) => [id, JSON.parse(readFileSync(new URL(`../../desktop/releases/${FEED_FILES[id]}`, import.meta.url), 'utf8'))]),
  );
  const env = {
    ASSETS: {
      async fetch(request: Request) {
        return new URL(request.url).pathname === '/release.json' ? Response.json(feeds) : new Response(null, { status: 404 });
      },
    },
  };
  const asset = (tag: string, name: string) => ({
    name,
    state: 'uploaded',
    browser_download_url: `https://github.com/JimLiu/baocut/releases/download/${tag}/${name}`,
  });
  // 比仓库里任何更新源都新的两次发布：999 只传完了 macOS，998 只有 Windows。
  const github = [
    {
      tag_name: 'baocut-v9.9.9-build.999',
      draft: false,
      prerelease: false,
      published_at: '2027-01-02T03:04:05Z',
      assets: ['dmg', 'zip'].map((ext) =>
        asset('baocut-v9.9.9-build.999', `BaoCut-9.9.9-build.999-aarch64-apple-darwin.${ext}`),
      ),
    },
    {
      tag_name: 'baocut-v9.9.8-build.998',
      draft: false,
      prerelease: false,
      published_at: '2027-01-01T03:04:05Z',
      assets: ['-setup.exe', '.zip', '-cuda-setup.exe', '-cuda.zip', '-vulkan-setup.exe', '-vulkan.zip'].map((suffix) =>
        asset('baocut-v9.9.8-build.998', `BaoCut-9.9.8-build.998-win-x64${suffix}`),
      ),
    },
  ];
  const cache = new Map<string, Response>();
  const requests: Request[] = [];
  // 每次重取都会记一条日志；测试里收起来，需要时检查内容。
  const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeAll(() => {
    vi.stubGlobal('caches', {
      default: {
        async match(request: Request) {
          return cache.get(request.url)?.clone();
        },
        async put(request: Request, response: Response) {
          cache.set(request.url, response);
        },
      },
    });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** 换一份模块，相当于 Workers 新起的一个实例：内存里什么都没有。 */
  async function freshWorker() {
    vi.resetModules();
    return (await import('./worker.ts')).default;
  }

  it('answers from the snapshot at once and picks up GitHub Releases afterwards', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json(github);
    });
    const fresh = await freshWorker();
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) };
    const summary = async () =>
      (await (await fresh.fetch(new Request('https://baocut.com/api/release'), env, ctx)).json()) as {
        version: string;
        downloads: Record<string, string>;
      };

    expect((await summary()).version).not.toBe('9.9.9');
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://api.github.com/repos/jimliu/baocut/releases?per_page=5');
    expect(requests[0]!.headers.get('User-Agent')).toBe('baocut-portal');

    const latest = await summary();
    expect(latest.version).toBe('9.9.9');
    expect(latest.downloads['mac-dmg']).toBe(
      'https://baocut.com/releases/download/baocut-v9.9.9-build.999/BaoCut-9.9.9-build.999-aarch64-apple-darwin.dmg',
    );
    expect(latest.downloads['win-vulkan-zip']).toBe(
      'https://baocut.com/releases/download/baocut-v9.9.8-build.998/BaoCut-9.9.8-build.998-win-x64-vulkan.zip',
    );
    const download = await fresh.fetch(new Request('https://baocut.com/download/win-setup'), env, ctx);
    expect(download.headers.get('Location')).toMatch(/\/baocut-v9\.9\.8-build\.998\/BaoCut-9\.9\.8-build\.998-win-x64-setup\.exe$/);
    expect(pending).toHaveLength(1);
  });

  it('lets a new instance start from the shared cache without waiting for GitHub', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchSpy);
    const fresh = await freshWorker();
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) };
    const response = await fresh.fetch(new Request('https://baocut.com/download/mac-zip'), env, ctx);
    expect(response.headers.get('Location')).toMatch(/\/BaoCut-9\.9\.9-build\.999-aarch64-apple-darwin\.zip$/);
    expect(pending).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the token to GitHub and logs the rate limit without the token', async () => {
    cache.clear();
    logs.mockClear();
    const sent: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new Request(input, init));
      return Response.json(github, { headers: { 'X-RateLimit-Limit': '5000', 'X-RateLimit-Remaining': '4999' } });
    });
    const fresh = await freshWorker();
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) };
    await fresh.fetch(new Request('https://baocut.com/api/release'), { ...env, GITHUB_TOKEN: 'test-token' }, ctx);
    await Promise.all(pending);
    expect(sent[0]!.headers.get('Authorization')).toBe('Bearer test-token');
    expect(logs).toHaveBeenCalledWith({
      event: 'github-releases',
      token: true,
      status: 200,
      limit: 5000,
      remaining: 4999,
      builds: { mac: 999, win: 998, 'win-cuda': 998, 'win-vulkan': 998 },
    });
    expect(JSON.stringify(logs.mock.calls)).not.toContain('test-token');
  });

  it('logs why GitHub was not used and keeps answering', async () => {
    cache.clear();
    warnings.mockClear();
    vi.stubGlobal('fetch', async () => Response.json({ message: 'Bad credentials' }, { status: 401, headers: { 'X-RateLimit-Limit': '60' } }));
    const fresh = await freshWorker();
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) };
    const call = () => fresh.fetch(new Request('https://baocut.com/download/mac-dmg'), env, ctx);
    expect((await call()).status).toBe(302);
    await Promise.all(pending);
    expect(warnings).toHaveBeenCalledWith({ event: 'github-releases', token: false, status: 401, limit: 60, remaining: null });
    expect((await call()).headers.get('Location')).not.toContain('9.9.9');
  });
});
