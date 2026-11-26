import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { BaoCutClient } from '@baocut/client';
import { PROTOCOL_VERSION, RpcError, newId, webExportDownloadPath, webVideoHref, type Id, type Project, type ServicesEvent, type ServicesSnapshot } from '@baocut/protocol';
import { resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { resolveExportWorkerCommand } from '../exports/video-export.ts';
import { startRuntime, type RunningRuntime, type StartRuntimeOptions } from '../runtime.ts';
import { resolveWebDist } from './web-static.ts';
import { ToolDriver, until } from '../agent-tools/testing/fake-agent.ts';

/**
 * Web 服务（架构设计 §4.8、§12.8）：访问链接与会话、来源检查、白名单、媒体与静态文件、安全头。
 * 只用回环地址、系统挑的端口、临时的 Runtime Home 与临时的构建产物目录；不打开浏览器。
 */

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** 原样发一个 HTTP 请求（fetch 不让改 Host）。 */
function send(url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: options.method ?? 'GET',
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    request.end(options.body);
  });
}

/** WebSocket 升级的结果：101 表示接受，其余是拒绝时的 HTTP 状态。 */
function upgrade(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.on('unexpected-response', (request, response) => {
      resolve(response.statusCode!);
      request.destroy();
    });
    socket.on('open', () => {
      resolve(101);
      socket.close();
    });
    socket.on('error', (error) => reject(error));
  });
}

/** 带 Origin 与会话 cookie 的 WebSocket（浏览器会自动带上这两个头）。 */
function browserSocket(origin: string, cookie: string): typeof globalThis.WebSocket {
  class BrowserSocket extends WebSocket {
    constructor(address: string) {
      super(address, { headers: { Origin: origin, Cookie: cookie } });
    }
  }
  return BrowserSocket as unknown as typeof globalThis.WebSocket;
}

function details(error: unknown): unknown {
  return error instanceof RpcError ? { code: error.code, details: error.details } : error;
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

describe('Web 服务', () => {
  let dir: string;
  let dist: string;
  let home: RuntimeHome;
  let runtime: RunningRuntime | undefined;
  let desktop: BaoCutClient;
  const browsers: BaoCutClient[] = [];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-web-'));
    home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') });
    // 一份假的构建产物：入口页、一个脚本、一个隐藏文件；目录外面还有一个文件。
    dist = path.join(dir, 'dist');
    await fs.mkdir(path.join(dist, 'assets'), { recursive: true });
    await fs.writeFile(
      path.join(dist, 'index.html'),
      '<!doctype html><div id="root"></div><script type="module" src="/assets/app.js"></script>',
    );
    await fs.writeFile(path.join(dist, 'assets', 'app.js'), 'console.log("app");');
    await fs.writeFile(path.join(dist, '.env'), 'SECRET=1');
    await fs.writeFile(path.join(dir, 'outside.txt'), 'outside');
  });

  afterEach(async () => {
    for (const browser of browsers.splice(0)) browser.close();
    desktop?.close();
    await runtime?.close();
    runtime = undefined;
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function boot(
    web: NonNullable<StartRuntimeOptions['services']>['web'] = { dist },
    extra: Partial<StartRuntimeOptions> = {},
  ): Promise<BaoCutClient> {
    runtime = await startRuntime({
      ...extra,
      home,
      drivers: () => [new ToolDriver()],
      watchSpace: false,
      engineHost: null,
      modelWorker: null,
      initiator: { discoverer: null },
      nodes: { host: '127.0.0.1', advertiser: null },
      services: { web },
    });
    const { endpoint, token } = runtime.discovery;
    desktop = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await desktop.connect();
    return desktop;
  }

  /** 开启 Web 服务（系统挑的端口），返回它的来源 `http://127.0.0.1:<端口>`。 */
  async function openWeb(): Promise<string> {
    await desktop.request('services.configure', { serviceId: 'web', port: 0 });
    const { service } = await desktop.request('services.start', { serviceId: 'web' });
    expect(service.state).toBe('on');
    expect(service.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    return service.endpoint!.slice(0, -1);
  }

  async function accessCode(): Promise<string> {
    const { url } = await desktop.request('services.web.createAccessLink', {});
    const match = /#code=([A-Za-z0-9_-]+)$/.exec(url);
    expect(match).not.toBeNull();
    return match![1]!;
  }

  function exchange(origin: string, code: string, headers: Record<string, string> = { Origin: origin }): Promise<Reply> {
    return send(`${origin}/_auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ code }),
    });
  }

  /** 走一遍登录：取访问链接、换会话。返回 `Cookie` 请求头的值。 */
  async function login(origin: string): Promise<string> {
    const reply = await exchange(origin, await accessCode());
    expect(reply.status).toBe(204);
    return reply.headers['set-cookie']![0]!.split(';')[0]!;
  }

  async function browser(origin: string, cookie: string): Promise<BaoCutClient> {
    const client = new BaoCutClient({
      resolve: async () => ({ endpoint: `${origin.replace('http:', 'ws:')}/ws`, token: '' }),
      client: { kind: 'desktop', name: 'browser', version: '0' },
      reconnect: false,
      WebSocket: browserSocket(origin, cookie),
    });
    browsers.push(client);
    await client.connect();
    return client;
  }

  it('附件上传是同源且绑定会话的单次地址；普通文件可交给不支持图片的 Agent', async()=>{
    await boot();const origin=await openWeb(),cookie=await login(origin),other=await login(origin),page=await browser(origin,cookie);
    const body='name,count\ncover,3\n';
    const prepared=await page.request('attachments.prepare',{fileName:'items.csv',mimeType:'text/csv',size:Buffer.byteLength(body)});
    expect(prepared.attachment.kind).toBe('file');expect(prepared.uploadUrl).toMatch(/^\/attachments\//);
    const url=origin+prepared.uploadUrl,headers={Origin:origin,Cookie:cookie,'Content-Type':'text/csv','Content-Length':String(Buffer.byteLength(body))};
    expect((await send(url,{method:'PUT',body,headers:{...headers,Cookie:other}})).status).toBe(403);
    expect((await send(url,{method:'PUT',body,headers:{...headers,Origin:'http://other.invalid'}})).status).toBe(403);
    expect((await send(url,{method:'PUT',body,headers})).status).toBe(204);
    expect((await send(url,{method:'PUT',body,headers})).status).toBe(403);
    const {conversation}=await page.request('conversations.create',{driverId:'codex'});
    await page.request('conversations.send',{conversationId:conversation.id,text:'Read the attached table',commandId:newId('cmd'),attachments:[prepared.attachment.id]});
    const handle=await page.request('media.resolve',{conversationId:conversation.id,attachmentId:prepared.attachment.id});
    expect(handle.contentKind).toBe('text');expect(handle.fileName).toBe('items.csv');
    const content=await send(origin+handle.url,{headers:{Cookie:cookie}});expect(content.body).toBe(body);
    expect((await send(origin+handle.url)).status).toBe(401);
    await desktop.request('services.configure',{serviceId:'web',readOnly:true});
    await expect(page.request('attachments.prepare',{fileName:'blocked.csv',mimeType:'text/csv',size:1})).rejects.toBeTruthy();
  });

  it('代码包在专用端口上：句柄是那个来源的绝对地址，CSP 放开同源、只许 Web 页面嵌入；那个端口只给代码包，主端口不认这种句柄', async () => {
    await boot();
    const origin = await openWeb();
    const bundle = path.join(dir, 'video', 'assets', 'bundle');
    await fs.mkdir(bundle, { recursive: true });
    await fs.writeFile(path.join(bundle, 'index.html'), '<!doctype html><head></head><body>bundle</body>');
    const handle = await runtime!.services.web.media.issueBundle(path.join(dir, 'video'), 'assets/bundle', { entry: 'index.html', inject: '<script>1</script>' });
    expect(handle.isolation).toBe('origin');
    const own = new URL(handle.url);
    expect(own.hostname).toBe('127.0.0.1');
    expect(own.port).not.toBe(new URL(origin).port);
    const page = await send(handle.url + handle.entry, { headers: { 'Sec-Fetch-Site': 'same-site' } });
    expect(page.status).toBe(200);
    expect(page.body).toBe('<!doctype html><head><script>1</script></head><body>bundle</body>');
    expect(page.headers['x-frame-options']).toBeUndefined();
    const csp = page.headers['content-security-policy'] as string;
    expect(csp).toContain('sandbox allow-scripts allow-same-origin');
    expect(csp).toContain(`frame-ancestors ${origin} http://localhost:${new URL(origin).port}`);
    // 主端口不给专用来源的句柄（那里会与页面同源）；专用端口上别的路径、别的 Host 都不给。
    expect((await send(origin + own.pathname + handle.entry)).status).toBe(404);
    expect((await send(`${own.origin}/home`)).status).toBe(404);
    expect((await send(`${own.origin}/media/x`)).status).toBe(404);
    expect((await send(handle.url + handle.entry, { headers: { Host: `localhost:${own.port}` } })).status).toBe(403);
    // Web 页面的 CSP 允许嵌这个端口
    const app = await send(origin + '/', { headers: { Cookie: await login(origin) } });
    expect(app.headers['content-security-policy']).toContain(`frame-src 'self' blob: ${origin} http://localhost:${new URL(origin).port} ${own.origin}`);
    await desktop.request('services.stop', { serviceId: 'web' });
    await expect(send(handle.url + handle.entry)).rejects.toBeTruthy();
  });

  it('代码包端口开不起来时退回主端口：句柄是同源的相对地址，沙箱不开同源', async () => {
    await boot();
    const origin = await openWeb();
    runtime!.services.web.media.setBundleOrigin(null);
    const bundle = path.join(dir, 'video', 'assets', 'bundle');
    await fs.mkdir(bundle, { recursive: true });
    await fs.writeFile(path.join(bundle, 'index.html'), '<!doctype html><head></head><body>bundle</body>');
    const handle = await runtime!.services.web.media.issueBundle(path.join(dir, 'video'), 'assets/bundle', { entry: 'index.html', inject: '<script>1</script>' });
    expect(handle.url).toMatch(/^\/bundle\/[A-Za-z0-9_-]+\/$/);
    const page = await send(origin + handle.url + handle.entry, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(page.status).toBe(200);
    expect(page.body).toBe('<!doctype html><head><script>1</script></head><body>bundle</body>');
    expect(page.headers['x-frame-options']).toBeUndefined();
    expect(page.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(page.headers['content-security-policy']).toContain('sandbox allow-scripts');
    // 同源的相对句柄在 CSP 里要补成带主机的绝对前缀，否则来源表达式无效。
    expect(page.headers['content-security-policy']).toContain(`script-src 'unsafe-inline' 'wasm-unsafe-eval' ${origin}${handle.url}`);
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    // 模块脚本按 CORS 取，沙箱里带 `Origin: null`：不被来源检查拦下，响应放行这个来源。
    const module = await send(origin + handle.url + handle.entry, { headers: { 'Sec-Fetch-Site': 'cross-site', Origin: 'null' } });
    expect(module.status).toBe(200);
    expect(module.headers['access-control-allow-origin']).toBe('null');
    expect((await send(origin + '/home', { headers: { Origin: 'null' } })).status).toBe(403);
    expect((await send(`${origin}/bundle/${'A'.repeat(32)}/index.html`)).status).toBe(404);
    expect((await send(`${origin}/bundle/`)).status).toBe(404);
  });

  it('默认关闭、端口 47622；没有构建产物时开启进入 error 并说明，Runtime 照常', async () => {
    await boot({ dist: null });
    const before = (await desktop.request('services.list', {})).services.find((s) => s.serviceId === 'web')!;
    expect(before).toMatchObject({ available: true, state: 'off', port: 47622, web: { readOnly: false, methods: null } });

    await desktop.request('services.configure', { serviceId: 'web', port: 0 });
    const { service } = await desktop.request('services.start', { serviceId: 'web' });
    expect(service).toMatchObject({ state: 'error', endpoint: null });
    expect(service.error).toContain('npm run build:web');
    expect((await desktop.request('runtime.info', {})).instanceId).toBeTruthy();
    // 没开着时不发访问链接。
    expect(details(await desktop.request('services.web.createAccessLink', {}).catch((e: unknown) => e))).toMatchObject({
      code: 'conflict',
      details: { code: 'SERVICE_NOT_RUNNING' },
    });
  });

  it('未登录：只有登录页；静态文件、媒体与网关都要会话；每个响应都带安全头', async () => {
    await boot();
    const origin = await openWeb();

    const page = await send(`${origin}/`);
    expect(page.status).toBe(200);
    expect(page.body).toContain('baocut web open');
    expect(page.body).not.toContain('id="root"');
    expect(page.headers).toMatchObject({ ...SECURITY_HEADERS, 'cache-control': 'no-store' });
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect(page.headers['content-security-policy']).not.toContain("unsafe-inline'; connect-src *");
    const script = await send(`${origin}/_auth/login.js`);
    expect(script.status).toBe(200);
    expect(script.headers['content-type']).toContain('text/javascript');
    // 登录页有一个输入框，给 `baocut web open --launch`（浏览器打开不带代码的地址，代码粘进来）。
    expect(page.body).toMatch(/<input id="code"[^>]*type="text" autocomplete="one-time-code"/);
    expect(page.headers['content-security-policy']).toContain("form-action 'none'");

    for (const target of ['/assets/app.js', '/media/abc/clip.mp4', '/index.html.map']) {
      const refused = await send(`${origin}${target}`);
      expect(refused.status, target).toBe(401);
      expect(refused.headers, target).toMatchObject(SECURITY_HEADERS);
      expect(refused.headers['content-security-policy'], target).toContain("frame-ancestors 'none'");
    }
    expect((await send(`${origin}/`, { method: 'POST' })).status).toBe(405);
    // 界面内链接（访问链接直达视频时的 /home?video=…）没登录时同样是登录页，不是 401。
    for (const target of ['/home?video=%7B%22entryId%22%3A%22e1%22%7D', '/c/conv_1', '/space/video']) {
      const login = await send(`${origin}${target}`);
      expect(login.status, target).toBe(200);
      expect(login.body, target).toContain('baocut web open');
      expect(login.body, target).not.toContain('id="root"');
    }

    expect(await upgrade(`${origin.replace('http:', 'ws:')}/ws`, { Origin: origin })).toBe(401);
    expect(
      await upgrade(`${origin.replace('http:', 'ws:')}/ws`, { Origin: origin, Cookie: `baocut_web_${new URL(origin).port}=x.y` }),
    ).toBe(401);
  });

  it('登录页的脚本：链接 fragment 里的代码立即兑换并从地址栏抹掉；粘贴的代码或整条链接经输入框兑换', async () => {
    await boot();
    const origin = await openWeb();
    const source = (await send(`${origin}/_auth/login.js`)).body;
    const code = 'A'.repeat(43);
    const run = (hash: string, where: { pathname: string; search: string } = { pathname: '/', search: '' }, ok = false) => {
      const posted: unknown[] = [];
      const listeners: Record<string, (event: { preventDefault(): void }) => void> = {};
      const element = (id: string) => ({ id, textContent: '', value: '', disabled: false, focus() {} });
      const elements: Record<string, ReturnType<typeof element> & { addEventListener?: unknown }> = {
        status: element('status'),
        code: element('code'),
        submit: element('submit'),
        login: Object.assign(element('login'), {
          addEventListener: (type: string, listener: (event: { preventDefault(): void }) => void) => (listeners[type] = listener),
        }),
      };
      const replaced: string[] = [];
      const went: string[] = [];
      const location = { hash, ...where, replace: (url: string) => went.push(url) };
      vm.runInNewContext(source, {
        document: { getElementById: (id: string) => elements[id] },
        location,
        history: { replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) },
        fetch: (url: string, init: { body: string }) => {
          posted.push([url, JSON.parse(init.body)]);
          return ok ? Promise.resolve({ ok: true }) : new Promise(() => {});
        },
      });
      const submit = (value: string) => {
        elements.code!.value = value;
        listeners.submit!({ preventDefault() {} });
      };
      return { posted, replaced, went, submit, status: elements.status! };
    };

    const fromLink = run(`#code=${code}`);
    expect(fromLink.replaced).toEqual(['/']);
    expect(fromLink.posted).toEqual([['/_auth/session', { code }]]);

    const pasted = run('');
    expect(pasted.posted).toEqual([]);
    pasted.submit('不是代码');
    expect(pasted.posted).toEqual([]);
    expect(pasted.status.textContent).toContain('格式不对');
    pasted.submit(`  ${code}\n`);
    expect(pasted.posted).toEqual([['/_auth/session', { code }]]);
    const wholeLink = run('');
    wholeLink.submit(`${origin}/#code=${code}`);
    expect(wholeLink.posted).toEqual([['/_auth/session', { code }]]);

    // 登录成功后回到访问链接的路径与查询（直达视频时是 /home?video=…），不是根路径。
    const search = '?video=%7B%22entryId%22%3A%22e1%22%7D';
    const deep = run(`#code=${code}`, { pathname: '/home', search }, true);
    expect(deep.replaced).toEqual(['/home' + search]);
    await until(() => deep.went.length > 0);
    expect(deep.went).toEqual(['/home' + search]);
    const root = run(`#code=${code}`, { pathname: '/', search: '' }, true);
    await until(() => root.went.length > 0);
    expect(root.went).toEqual(['/']);
  });

  it('审片页的脚本：fragment 里的密钥连同路径上的视频换审片会话，地址栏原样保留；缺密钥、视频没了分别说明', async () => {
    await boot();
    const origin = await openWeb();
    const source = (await send(`${origin}/_auth/review.js`)).body;
    const key = 'B'.repeat(43);
    const run = (hash: string, pathname: string, status = 0) => {
      const posted: unknown[] = [];
      const element = { textContent: '' };
      let reloaded = false;
      vm.runInNewContext(source, {
        document: { getElementById: () => element },
        location: { hash, pathname, reload: () => (reloaded = true) },
        fetch: (url: string, init: { body: string }) => {
          posted.push([url, JSON.parse(init.body)]);
          return status ? Promise.resolve({ ok: status === 200, status }) : new Promise(() => {});
        },
      });
      return { posted, element, reloaded: () => reloaded };
    };

    expect(run(`#key=${key}`, '/review/vid%201').posted).toEqual([['/_auth/review', { video: 'vid 1', key }]]);
    const missing = run('', '/review/vid_1');
    expect(missing.posted).toEqual([]);
    expect(missing.element.textContent).not.toBe('');
    const ok = run(`#key=${key}`, '/review/vid_1', 200);
    await until(() => ok.reloaded());
    const gone = run(`#key=${key}`, '/review/vid_1', 404);
    await until(() => gone.element.textContent !== '');
  });

  it('访问链接只能用一次、过期作废；兑换要同源的 POST 与 JSON', async () => {
    await boot({ dist, codeTtlMs: 300 });
    const origin = await openWeb();

    const code = await accessCode();
    expect((await exchange(origin, code, {})).status).toBe(403);
    expect((await exchange(origin, code, { Origin: 'http://evil.example' })).status).toBe(403);
    expect((await send(`${origin}/_auth/session`, { method: 'GET', headers: { Origin: origin } })).status).toBe(405);
    expect(
      (await send(`${origin}/_auth/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: code }))
        .status,
    ).toBe(415);
    // 来源不对的请求没有碰到代码：这里第一次兑换成功，第二次就失败。
    const first = await exchange(origin, code);
    expect(first.status).toBe(204);
    const cookie = first.headers['set-cookie']![0]!;
    expect(cookie).toMatch(
      new RegExp(`^baocut_web_${new URL(origin).port}=wses_[^;]+\\.[A-Za-z0-9_-]+; HttpOnly; SameSite=Strict; Path=/; Max-Age=\\d+$`),
    );
    const again = await exchange(origin, code);
    expect(again.status).toBe(401);
    expect(JSON.parse(again.body)).toEqual({ error: 'ACCESS_CODE_INVALID' });

    // 不认识的代码同样 401……
    expect((await exchange(origin, 'not-a-real-code-at-all')).status).toBe(401);
    // ……过期的代码也是。
    const late = await accessCode();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await exchange(origin, late)).status).toBe(401);
    expect((await desktop.request('services.web.listSessions', {})).sessions).toHaveLength(1);
  });

  it('直达视频的访问链接：找不到的 videoId 以 VIDEO_NOT_FOUND 拒绝，不发代码', async () => {
    await boot();
    await openWeb();
    expect(
      details(await desktop.request('services.web.createAccessLink', { video: 'video_0123456789abcdef' }).catch((e: unknown) => e)),
    ).toMatchObject({ code: 'not-found', details: { code: 'VIDEO_NOT_FOUND', videoId: 'video_0123456789abcdef' } });
    // 不给 video 时照旧是根路径。
    expect((await desktop.request('services.web.createAccessLink', {})).url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#code=[A-Za-z0-9_-]+$/);
  });

  it('Host 与 Origin：只接受自己的回环来源；别的站点发起的请求拿不到需要会话的内容', async () => {
    await boot();
    const origin = await openWeb();
    const port = new URL(origin).port;
    const cookie = await login(origin);
    const ws = `${origin.replace('http:', 'ws:')}/ws`;

    // 登录后的入口页是客户端，带客户端自己的 CSP。
    const index = await send(`${origin}/`, { headers: { Cookie: cookie } });
    expect(index.status).toBe(200);
    expect(index.body).toContain('id="root"');
    const csp = index.headers['content-security-policy']!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain(`connect-src 'self' blob: ws://127.0.0.1:${port} ws://localhost:${port}`);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(index.headers).toMatchObject(SECURITY_HEADERS);
    expect((await send(`${origin}/assets/app.js`, { headers: { Cookie: cookie, Host: `localhost:${port}` } })).status).toBe(200);
    // 界面内链接是同一个客户端页面（带客户端的 CSP），由客户端按路径与查询去对应的界面；带扩展名的仍按文件找。
    for (const target of ['/home?video=%7B%22entryId%22%3A%22e1%22%7D', '/c/conv_1', '/settings/models/asr']) {
      const routed = await send(`${origin}${target}`, { headers: { Cookie: cookie } });
      expect(routed.status, target).toBe(200);
      expect(routed.body, target).toContain('id="root"');
      expect(routed.headers['content-security-policy'], target).toBe(csp);
    }
    expect((await send(`${origin}/assets/missing.js`, { headers: { Cookie: cookie } })).status).toBe(404);
    expect((await send(`${origin}/.env`, { headers: { Cookie: cookie } })).status).toBe(404);

    // DNS 重绑定：Host 不是自己的回环地址。
    for (const host of ['evil.example', `evil.example:${port}`, `127.0.0.1:${Number(port) + 1}`]) {
      expect((await send(`${origin}/assets/app.js`, { headers: { Cookie: cookie, Host: host } })).status, host).toBe(403);
      expect(await upgrade(ws, { Origin: origin, Cookie: cookie, Host: host }), host).toBe(403);
    }
    // 跨来源：Origin 不对，或浏览器标明是别的站点发起的。
    for (const other of ['http://evil.example', `http://127.0.0.1:${Number(port) + 1}`, 'null']) {
      expect((await send(`${origin}/assets/app.js`, { headers: { Cookie: cookie, Origin: other } })).status, other).toBe(403);
      expect(await upgrade(ws, { Origin: other, Cookie: cookie }), other).toBe(403);
    }
    expect(await upgrade(ws, { Cookie: cookie }), '没有 Origin').toBe(403);
    expect((await send(`${origin}/assets/app.js`, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect((await send(`${origin}/assets/app.js`, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-site' } })).status).toBe(403);
    const crossNav = await send(`${origin}/`, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } });
    expect(crossNav.body).not.toContain('id="root"');
    expect((await send(`${origin}/assets/app.js`, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(200);
    expect(await upgrade(ws, { Origin: `http://localhost:${port}`, Cookie: cookie })).toBe(101);
    expect(await upgrade(`${origin.replace('http:', 'ws:')}/other`, { Origin: origin, Cookie: cookie })).toBe(404);

    // 构建产物目录之外与隐藏文件不给。
    for (const target of ['/.env', '/%2e%2e/outside.txt', '/assets/%2e%2e/%2e%2e/outside.txt', '/nope.js']) {
      expect((await send(`${origin}${target}`, { headers: { Cookie: cookie } })).status, target).toBe(404);
    }
  });

  it('会话：主体是浏览器会话；列出与吊销，吊销立即断开；会话过期后不再执行；服务停止后全部作废', async () => {
    await boot({ dist, sessionTtlMs: 1500 });
    const origin = await openWeb();
    const cookie = await login(origin);
    const page = await browser(origin, cookie);
    expect((await page.request('runtime.info', {})).instanceId).toBeTruthy();

    const { sessions } = await desktop.request('services.web.listSessions', {});
    expect(sessions).toHaveLength(1);
    const sessionId = sessions[0]!.sessionId;
    expect(cookie).toContain(`=${sessionId}.`);
    await until(async () => (await desktop.request('services.web.listSessions', {})).sessions[0]?.connections === 1);
    const listed = (await desktop.request('services.list', {})).services.find((s) => s.serviceId === 'web')!;
    expect(listed.clients).toEqual([expect.objectContaining({ clientId: sessionId, name: '浏览器会话' })]);

    // 吊销：连接断开，cookie 不再能连网关或取文件。
    const other = await login(origin);
    const otherPage = await browser(origin, other);
    expect((await desktop.request('services.web.revokeSession', { sessionId })).sessions.map((s) => s.sessionId)).not.toContain(sessionId);
    await until(() => page.state.status === 'disconnected');
    expect(await upgrade(`${origin.replace('http:', 'ws:')}/ws`, { Origin: origin, Cookie: cookie })).toBe(401);
    expect((await send(`${origin}/assets/app.js`, { headers: { Cookie: cookie } })).status).toBe(401);
    // 别的会话不受影响。
    expect((await otherPage.request('runtime.info', {})).instanceId).toBeTruthy();
    expect(details(await desktop.request('services.web.revokeSession', { sessionId }).catch((e: unknown) => e))).toMatchObject({
      code: 'not-found',
    });

    // 会话过期：连着的连接上的请求也被拒绝。
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect(details(await otherPage.request('runtime.info', {}).catch((e: unknown) => e))).toMatchObject({ code: 'unauthenticated' });
    expect((await send(`${origin}/assets/app.js`, { headers: { Cookie: other } })).status).toBe(401);

    // 服务停止：会话与代码随之作废。
    const third = await login(origin);
    void third;
    await desktop.request('services.stop', { serviceId: 'web' });
    expect((await desktop.request('services.web.listSessions', {})).sessions).toEqual([]);
  });

  it('白名单：默认集合之内可用，设置、凭据、对外服务与节点管理 forbidden；主题同样过滤；配置只能收紧，改了立即生效', async () => {
    await boot();
    const origin = await openWeb();
    const cookie = await login(origin);
    let page = await browser(origin, cookie);

    expect((await page.request('projects.list', {})).projects).toEqual([]);
    expect((await page.request('settings.get', {})).settings).toBeTruthy();
    expect((await page.request('models.capabilities', {})).capabilities).toBeTruthy();
    // 用量（§6.10）在默认集合里：只读、不含密钥。
    expect((await page.request('models.usage', { period: '7d' })).totals.calls).toBe(0);
    expect(Array.isArray((await page.request('skills.list', {})).skills)).toBe(true);
    const refused: [string, unknown][] = [
      ['settings.set', { patch: {} }],
      ['models.configure', { providerId: 'openai', enabled: true }],
      ['models.removeProvider', { providerId: 'openai' }],
      // 账号的写方法与 models.configure 一样不开放（§6.4）。
      ['models.addAccount', { providerId: 'openai', credential: 'sk-test-web' }],
      ['models.updateAccount', { providerId: 'openai', accountId: 'main', enabled: false }],
      ['models.removeAccount', { providerId: 'openai', accountId: 'main' }],
      ['models.arrangeAccounts', { providerId: 'openai', order: ['main'] }],
      // 链接账号（CLI 独立使用与发布 §7.1）读的是另一个 Runtime Home，只在 CLI 里做。
      ['models.linkAccounts', { home: '/tmp/other-home' }],
      ['services.list', {}],
      ['services.web.createAccessLink', {}],
      ['services.mcp.createClient', { name: 'x' }],
      ['services.modelApi.createClient', { name: 'x' }],
      ['services.modelApi.setAlias', { alias: 'a', capability: 'transcribe', providerId: 'local' }],
      ['services.configure', { serviceId: 'web', readOnly: false }],
      ['nodes.pair', { nodeId: 'n', code: '123456' }],
      ['nodes.share.status', {}],
      ['pipelines.list', {}],
      ['pipelines.start', { pipeline: 'transcode', params: { inputs: ['/tmp/x.mp4'], action: 'compress' } }],
      ['pipelines.retry', { jobId: 'job_x' }],
      ['models.install', { bundleId: 'qwen3-asr-0.6b@mlx-4bit' }],
      ['models.repair', { bundleId: 'qwen3-asr-0.6b@mlx-4bit' }],
      ['models.cancelInstall', { bundleId: 'qwen3-asr-0.6b@mlx-4bit' }],
      ['models.remove', { bundleId: 'qwen3-asr-0.6b@mlx-4bit' }],
      ['models.test', { bundleId: 'qwen3-asr-0.6b@mlx-4bit' }],
      ['pipelines.start', { pipeline: 'link-import', params: { url: 'https://video.example.com/watch?v=a' } }],
      ['externalTools.list', {}],
      ['externalTools.detect', {}],
      ['externalTools.install', { name: 'yt-dlp', consent: true }],
      ['externalTools.update', { name: 'yt-dlp', command: 'brew upgrade yt-dlp' }],
      ['externalTools.setPath', { name: 'yt-dlp', path: '/tmp/yt-dlp' }],
      ['externalTools.remove', { name: 'yt-dlp' }],
      ['externalTools.consent', { name: 'yt-dlp', grant: true }],
      ['fonts.catalogue', {}],
      ['fonts.download', { family: 'Lobster' }],
      ['fonts.downloaded', {}],
      ['fonts.remove', { family: 'Lobster' }],
      ['fonts.clear', {}],
      ['skills.add', { path: '/tmp/x-skill' }],
      ['skills.importGithub', { url: 'o/r' }],
      ['skills.remove', { id: 'x' }],
    ];
    let forbidden = 0;
    for (const [method, params] of refused) {
      const error = await page.request(method as 'services.list', params as Record<string, never>).catch((e: unknown) => e);
      // 参数不合法的会先在网关被拒（invalid-request），同样没有执行；参数合法的都是 forbidden。
      if (error instanceof RpcError && error.code === 'invalid-request') continue;
      expect(details(error), method).toMatchObject({ code: 'forbidden', details: { code: 'WEB_METHOD_NOT_ALLOWED', method } });
      forbidden++;
    }
    expect(forbidden).toBeGreaterThanOrEqual(refused.length - 3);
    // 受管外部工具连状态也不给浏览器：状态里有本机路径，安装与同意决定这台机器执行哪个程序（§12.9）。
    expect(details(await page.request('externalTools.list', {}).catch((e: unknown) => e))).toMatchObject({
      code: 'forbidden',
      details: { code: 'WEB_METHOD_NOT_ALLOWED', method: 'externalTools.list' },
    });
    // 只开放本机浏览器的列表（设置 › 视频下载只读地列出网站登录）：只有名称、修改时间与可选权限拒绝标记，没有路径。
    const detected = (await page.request('externalTools.cookieBrowsers', {})) as unknown as { platform: string; browsers: Record<string, unknown>[] };
    expect(detected.platform).toBe(process.platform);
    for (const browser of detected.browsers) {
      expect(Object.keys(browser).sort()).toEqual([
        ...(browser.accessDenied ? ['accessDenied'] : []),
        ...(browser.cookieStoreMissing ? ['cookieStoreMissing'] : []),
        'id', 'label', 'lastUsedAt',
      ]);
      if ('accessDenied' in browser) expect(browser.accessDenied).toBe(true);
      if ('cookieStoreMissing' in browser) expect(browser.cookieStoreMissing).toBe(true);
    }
    expect(details(await page.request('services.list', {}).catch((e: unknown) => e))).toMatchObject({
      code: 'forbidden',
      details: { code: 'WEB_METHOD_NOT_ALLOWED' },
    });
    expect(details(await page.request('subscribe', { topic: 'services' }).catch((e: unknown) => e))).toMatchObject({
      code: 'forbidden',
      details: { code: 'WEB_TOPIC_NOT_ALLOWED', topic: 'services' },
    });
    // 用户库还没有对浏览器开放：方法与主题都拒绝。
    expect(details(await page.request('library.list', {}).catch((e: unknown) => e))).toMatchObject({
      code: 'forbidden',
      details: { code: 'WEB_METHOD_NOT_ALLOWED' },
    });
    expect(details(await page.request('subscribe', { topic: 'library' }).catch((e: unknown) => e))).toMatchObject({
      code: 'forbidden',
      details: { code: 'WEB_TOPIC_NOT_ALLOWED', topic: 'library' },
    });
    // 数据外发的授权不对浏览器开放：查看、发放、撤销与主题都拒绝。
    for (const [method, params] of [
      ['grants.list', {}],
      ['grants.create', { recipient: 'openai', dataKinds: ['audio'], purpose: '转写', budgetMode: 'per-call-unknown-cost' }],
      ['grants.revoke', { grantId: 'grt_x' }],
    ] as const) {
      expect(details(await page.request(method as 'grants.list', params as never).catch((e: unknown) => e)), method).toMatchObject({
        code: 'forbidden',
        details: { code: 'WEB_METHOD_NOT_ALLOWED', method },
      });
    }
    expect(details(await page.request('subscribe', { topic: 'grants' }).catch((e: unknown) => e))).toMatchObject({
      code: 'forbidden',
      details: { code: 'WEB_TOPIC_NOT_ALLOWED', topic: 'grants' },
    });
    expect(await page.request('subscribe', { topic: 'directory' })).toMatchObject({ mode: 'snapshot' });
    expect(await page.request('subscribe', { topic: 'settings' })).toMatchObject({ mode: 'snapshot' });
    // Agent 的视图随 `agents.list` 开放（§3.11）。
    expect(await page.request('subscribe', { topic: 'agents' })).toMatchObject({ mode: 'snapshot' });

    // 配置只能在默认集合之内收紧；Web 服务没有访问等级与视频范围。
    for (const methods of [['settings.*'], ['services.list'], ['projects.*'], ['nodes.share.status']]) {
      expect(
        details(await desktop.request('services.configure', { serviceId: 'web', methods }).catch((e: unknown) => e)),
        methods[0],
      ).toMatchObject({
        code: 'invalid-request',
      });
    }
    expect(
      details(await desktop.request('services.configure', { serviceId: 'web', level: 'read' }).catch((e: unknown) => e)),
    ).toMatchObject({
      code: 'invalid-request',
    });
    // 局域网访问只属于模型接口服务（§12.8）：Web 服务仍然只在回环上。
    expect(
      details(await desktop.request('services.configure', { serviceId: 'web', lan: true }).catch((e: unknown) => e)),
    ).toMatchObject({
      code: 'invalid-request',
    });

    // 收紧：已有连接断开，重新连上后按新的白名单。
    const narrowed = await desktop.request('services.configure', {
      serviceId: 'web',
      methods: ['runtime.info', 'projects.list', 'conversations.*'],
    });
    expect(narrowed.service.web).toEqual({ readOnly: false, methods: ['runtime.info', 'projects.list', 'conversations.*'] });
    await until(() => page.state.status === 'disconnected');
    page = await browser(origin, cookie);
    expect((await page.request('conversations.list', {})).conversations).toBeDefined();
    expect(details(await page.request('projects.create', { name: 'x' }).catch((e: unknown) => e))).toMatchObject({
      code: 'forbidden',
      details: { code: 'WEB_METHOD_NOT_ALLOWED', method: 'projects.create' },
    });
    expect(details(await page.request('subscribe', { topic: 'jobs' }).catch((e: unknown) => e))).toMatchObject({
      details: { code: 'WEB_TOPIC_NOT_ALLOWED' },
    });

    // 只读：写入被拒绝，读取照常；恢复默认之后写入可用。
    await desktop.request('services.configure', { serviceId: 'web', methods: null, readOnly: true });
    await until(() => page.state.status === 'disconnected');
    page = await browser(origin, cookie);
    expect((await page.request('projects.list', {})).projects).toEqual([]);
    // 用量也在只读集合里。
    expect((await page.request('models.usage', { period: 'all' })).byProvider).toEqual([]);
    expect(details(await page.request('projects.create', { name: '只读' }).catch((e: unknown) => e))).toMatchObject({
      code: 'forbidden',
      details: { code: 'WEB_READ_ONLY', method: 'projects.create' },
    });
    expect(details(await page.request('conversations.create', {}).catch((e: unknown) => e))).toMatchObject({
      details: { code: 'WEB_READ_ONLY' },
    });
    // 导出：查询在只读下照常，新建是写入。
    expect(details(await page.request('exports.list', { videoId: 'vid_none' }).catch((e: unknown) => e))).not.toMatchObject({
      code: 'forbidden',
    });
    expect(
      details(
        await page
          .request('exports.create', { videoId: 'vid_none', settings: { kind: 'subtitles', format: 'srt' } })
          .catch((e: unknown) => e),
      ),
    ).toMatchObject({ code: 'forbidden', details: { code: 'WEB_READ_ONLY', method: 'exports.create' } });
    // 只排正文、不写文件：只读下照常（视频没打开是 not-found）。
    expect(
      details(
        await page
          .request('exports.renderText', { videoId: 'vid_none', settings: { kind: 'transcript', format: 'md' } })
          .catch((e: unknown) => e),
      ),
    ).toMatchObject({ code: 'not-found', details: { code: 'VIDEO_NOT_OPEN' } });
    // Space 条目的缩略图是读取：只读下照常（不存在的条目是 not-found，不是 WEB_READ_ONLY）。
    expect(details(await page.request('space.thumbnail', { entryId: 'sp_none' }).catch((e: unknown) => e))).toMatchObject({
      code: 'not-found',
    });
    // 任务对账是写入：只读下拒绝。
    expect(
      details(await page.request('jobs.reconcile', { jobId: 'job_none', decision: 'discard' }).catch((e: unknown) => e)),
    ).toMatchObject({
      code: 'forbidden',
      details: { code: 'WEB_READ_ONLY', method: 'jobs.reconcile' },
    });
    // 删除与恢复视频、从 Space 条目继续会话、改 Space 标记都是写入：只读下拒绝（space.update 转删除视频，不能借它绕过）。
    for (const [method, params] of [
      ['videos.delete', { entryId: 'sp_none' }],
      ['videos.restore', { entryId: 'sp_none' }],
      ['space.continueInConversation', { entryId: 'sp_none' }],
      ['space.update', { entryId: 'sp_none', trashed: true }],
      ['space.trash', { entryId: 'sp_none' }],
    ] as const) {
      expect(details(await page.request(method, params as never).catch((e: unknown) => e))).toMatchObject({
        code: 'forbidden',
        details: { code: 'WEB_READ_ONLY', method },
      });
    }
    // 任务合同（§3.2）：只读下能查看，不能建立、修改、换目标与记录检查结果。
    for (const [method, params] of [
      ['tasks.getContract', { taskId: 'task_none' }],
      ['tasks.listContracts', { taskId: 'task_none' }],
      ['tasks.listChecks', { taskId: 'task_none' }],
    ] as const) {
      expect(details(await page.request(method as 'tasks.getContract', params as never).catch((e: unknown) => e)), method).toMatchObject({
        code: 'not-found',
      });
    }
    for (const [method, params] of [
      ['tasks.create', { conversationId: 'conv_none', goal: 'x', commandId: 'cmd_1' }],
      ['tasks.updateContract', { taskId: 'task_none', expectedRevision: 1, commandId: 'cmd_1', patch: {} }],
      ['tasks.changeGoal', { taskId: 'task_none', goal: 'x', previousWork: 'stop', commandId: 'cmd_1' }],
      ['tasks.recordCheck', { taskId: 'task_none', checkId: 'check_1', outcome: 'passed' }],
    ] as const) {
      expect(details(await page.request(method as 'tasks.create', params as never).catch((e: unknown) => e)), method).toMatchObject({
        code: 'forbidden',
        details: { code: 'WEB_READ_ONLY', method },
      });
    }
    const stored = JSON.parse(await fs.readFile(home.servicesFile, 'utf8')) as Record<string, unknown>;
    expect(JSON.stringify(stored)).toContain('"readOnly":true');

    await desktop.request('services.configure', { serviceId: 'web', readOnly: false });
    await until(() => page.state.status === 'disconnected');
    page = await browser(origin, cookie);
    expect((await page.request('projects.create', { name: '浏览器建的' })).project.name).toBe('浏览器建的');
    // 写入类调用留下审计。
    const web = (await desktop.request('services.list', {})).services.find((s) => s.serviceId === 'web')!;
    expect(web.recentRequests[0]).toMatchObject({ clientName: '浏览器会话', tool: 'projects.create', outcome: 'ok' });
    // 不是只读时，删除视频与从条目继续会话在默认集合里（这里是不存在的条目，请求到达处理函数）。
    for (const method of ['videos.delete', 'space.continueInConversation'] as const) {
      expect(details(await page.request(method, { entryId: 'sp_none' }).catch((e: unknown) => e))).toMatchObject({ code: 'not-found' });
    }
    // 非只读：修改合同到达处理函数（这里是不存在的任务）。
    expect(
      details(
        await page
          .request('tasks.updateContract', { taskId: 'task_none', expectedRevision: 1, commandId: 'cmd_1', patch: {} })
          .catch((e: unknown) => e),
      ),
    ).toMatchObject({ code: 'not-found' });
    // 默认集合里有任务对账（`jobs.*`）：请求到达处理函数（这里是不存在的任务）；retry 照常经授权与预算准入。
    expect(details(await page.request('jobs.reconcile', { jobId: 'job_none', decision: 'retry' }).catch((e: unknown) => e))).toMatchObject({
      code: 'not-found',
    });
    const audited = (await desktop.request('services.list', {})).services.find((s) => s.serviceId === 'web')!;
    expect(audited.recentRequests[0]).toMatchObject({ clientName: '浏览器会话', tool: 'jobs.reconcile', outcome: 'not-found' });
  });

  it('工具目录：浏览器能读目录与候选输入；执行方法不在白名单或只读时标为不可用；外部工具的问题不带本机路径与补救', async () => {
    const emptyPath = path.join(dir, 'empty-path');
    await fs.mkdir(emptyPath);
    // PATH 只有一个空目录、不读真实环境里的覆盖：外部工具都是没装。
    await boot({ dist }, { externalTools: { env: async () => ({ PATH: emptyPath }), overrides: {} } });
    const origin = await openWeb();
    const cookie = await login(origin);
    let page = await browser(origin, cookie);

    const { tools } = await page.request('tools.list', {});
    const byId = (id: string) => tools.find((t) => t.id === id)!;
    expect(tools.map((t) => t.id)).toEqual([
      'transcribe',
      'translate-subtitles',
      'dub',
      'synthesize-speech',
      'generate-text',
      'generate-image',
      'upscale-image',
      'remove-object',
      'remove-watermark',
      'repaint-image',
      'expand-image',
      'generate-music',
      'link-import',
      'compress-video',
      'merge-video',
      'extract-audio',
      'stabilize-video',
      'upscale-video',
      'interpolate-video',
      'match-color',
      'remove-background',
      'separate-audio',
    ]);
    // 固定流程（pipelines.start）不对浏览器开放；直接任务（models.*）在默认集合里。
    const pipelineTools = ['transcribe', 'translate-subtitles', 'dub', 'upscale-image', 'remove-object', 'remove-watermark', 'repaint-image', 'expand-image'];
    for (const id of [...pipelineTools, 'link-import', 'compress-video', 'merge-video', 'extract-audio', 'stabilize-video', 'upscale-video', 'interpolate-video', 'match-color', 'remove-background', 'separate-audio']) {
      expect(byId(id), id).toMatchObject({ available: false });
      expect(byId(id).problems, id).toContainEqual(expect.objectContaining({ code: 'WEB_METHOD_NOT_ALLOWED' }));
    }
    for (const id of ['synthesize-speech', 'generate-image', 'generate-music', 'generate-text']) {
      expect(
        byId(id).problems.map((p) => p.code),
        id,
      ).not.toContain('WEB_METHOD_NOT_ALLOWED');
    }
    expect(byId('compress-video').problems).toContainEqual({
      code: 'TOOL_NOT_INSTALLED',
      tool: 'ffmpeg',
      message: '外部工具 ffmpeg 现在不能用：请在 BaoCut 桌面应用里处理',
      messageRef: { key: 'rcWeb.externalToolUnavailable', params: { tool: 'ffmpeg' } },
    });
    expect(JSON.stringify(tools)).not.toContain(emptyPath);
    // 保存位置是本机路径：浏览器拿不到，桌面拿到解析好的目录（没有设置时是主机的下载文件夹）。
    expect('saveDirectory' in (await page.request('tools.list', {}))).toBe(false);
    expect((await desktop.request('tools.list', {})).saveDirectory).toBe(process.env.BAOCUT_DOWNLOADS_DIR);
    // 保存位置（测试里是临时的下载文件夹）不在项目目录里：只写到保存位置的流程不可用，还能写进视频的只是受限；
    // 直接任务的结果在产物库里，不受影响。直接任务的 saveDir 在浏览器里只能是项目目录里的目录。
    expect(byId('compress-video').problems).toContainEqual(expect.objectContaining({ code: 'PATH_OUTSIDE_PROJECT' }));
    expect(byId('transcribe').limitations).toContainEqual(expect.objectContaining({ code: 'PATH_OUTSIDE_PROJECT' }));
    expect(byId('generate-text').problems.map((p) => p.code)).not.toContain('PATH_OUTSIDE_PROJECT');
    const prompt = { messages: [{ role: 'user' as const, content: '你好' }] };
    expect(
      details(await page.request('models.generateText', { ...prompt, saveDir: process.env.BAOCUT_DOWNLOADS_DIR! }).catch((e: unknown) => e)),
    ).toMatchObject({ code: 'forbidden', details: { code: 'PATH_OUTSIDE_PROJECT' } });
    const { project } = await desktop.request('projects.create', { name: '结果' });
    await desktop.request('settings.set', { values: { 'downloads.directory': path.join(project.path, '新建的输出') } });
    const inside = (await page.request('tools.list', {})).tools;
    expect(JSON.stringify(inside)).not.toContain('PATH_OUTSIDE_PROJECT');
    // 项目目录里（还不存在的子目录也算）的 saveDir 到达处理函数（这里没有配置文本模型）。
    expect(
      details(await page.request('models.generateText', { ...prompt, saveDir: path.join(project.path, 'a', 'b') }).catch((e: unknown) => e)),
    ).toMatchObject({ details: { code: 'CAPABILITY_NOT_CONFIGURED' } });
    // 生图的输入图给路径时同样只能在项目目录里（按真实路径）；项目里的图到达处理函数（这里没有配置生图模型）。
    const outsideImage = path.join(process.env.BAOCUT_DOWNLOADS_DIR!, 'outside.png');
    await fs.writeFile(outsideImage, 'x');
    expect(
      details(await page.request('models.generateImage', { prompt: 'x', images: [outsideImage] }).catch((e: unknown) => e)),
    ).toMatchObject({ code: 'forbidden', details: { code: 'PATH_OUTSIDE_PROJECT' } });
    await fs.writeFile(path.join(project.path, 'inside.png'), 'x');
    expect(
      details(
        await page.request('models.generateImage', { prompt: 'x', images: [path.join(project.path, 'inside.png')] }).catch((e: unknown) => e),
      ),
    ).toMatchObject({ details: { code: 'CAPABILITY_NOT_CONFIGURED' } });
    await desktop.request('settings.set', { values: { 'downloads.directory': null } });
    // 桌面照常拿到补救。
    const desktopTools = (await desktop.request('tools.list', {})).tools;
    expect(desktopTools.find((t) => t.id === 'compress-video')!.problems).toEqual([
      expect.objectContaining({ code: 'TOOL_NOT_INSTALLED', tool: 'ffmpeg', remedy: expect.any(String) }),
    ]);

    expect(await page.request('tools.candidates', { toolId: 'dub' })).toMatchObject({ toolId: 'dub', candidates: [], total: 0 });
    expect(details(await page.request('tools.candidates', { toolId: 'nope' }).catch((e: unknown) => e))).toMatchObject({
      code: 'not-found',
    });

    // 只读：目录与候选输入照常可读，直接任务标为只读。
    await desktop.request('services.configure', { serviceId: 'web', readOnly: true });
    await until(() => page.state.status === 'disconnected');
    page = await browser(origin, cookie);
    const readOnly = (await page.request('tools.list', {})).tools;
    expect(readOnly.find((t) => t.id === 'generate-text')).toMatchObject({
      available: false,
      problems: expect.arrayContaining([expect.objectContaining({ code: 'WEB_READ_ONLY' })]),
    });
    expect((await page.request('tools.candidates', { toolId: 'transcribe' })).candidates).toEqual([]);
  });

  it('项目与媒体：只能打开已登记的项目；媒体是同源的相对地址，支持 Range，没有会话不给，不暴露桌面的媒体通道', async () => {
    await boot();
    const origin = await openWeb();
    const cookie = await login(origin);
    const page = await browser(origin, cookie);

    const { project } = await desktop.request('projects.create', { name: '素材' });
    expect((await page.request('projects.open', { path: project.path })).project.id).toBe(project.id);
    const elsewhere = path.join(dir, 'elsewhere');
    await fs.mkdir(elsewhere);
    for (const target of [elsewhere, dir, path.join(project.path, '..'), 'relative/path']) {
      expect(details(await page.request('projects.open', { path: target }).catch((e: unknown) => e)), target).toMatchObject({
        code: 'forbidden',
        details: { code: 'PROJECT_NOT_REGISTERED' },
      });
    }
    expect((await desktop.request('projects.list', {})).projects.map((p) => p.path)).not.toContain(elsewhere);

    await fs.writeFile(path.join(project.path, 'notes.txt'), '0123456789');
    const handle = await page.request('media.resolve', { projectId: project.id, path: 'notes.txt' });
    expect(handle.url).toMatch(/^\/media\/[A-Za-z0-9_-]+\/notes\.txt$/);
    const ranged = await send(`${origin}${handle.url}`, { headers: { Cookie: cookie, Range: 'bytes=2-5' } });
    expect(ranged.status).toBe(206);
    expect(ranged.body).toBe('2345');
    expect(ranged.headers).toMatchObject({ 'content-range': 'bytes 2-5/10', 'accept-ranges': 'bytes', ...SECURITY_HEADERS });
    expect((await send(`${origin}${handle.url}`, { headers: { Cookie: cookie } })).body).toBe('0123456789');
    expect((await send(`${origin}${handle.url}`, { headers: { Cookie: cookie, Range: 'bytes=20-30' } })).status).toBe(416);
    expect((await send(`${origin}${handle.url}`)).status).toBe(401);
    expect((await send(`${origin}${handle.url}`, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);

    // 浏览器的句柄只在 Web 服务的端口上有效；桌面的媒体通道不认它。
    const gateway = runtime!.discovery.endpoint.replace('ws:', 'http:');
    expect((await send(`${gateway}${handle.url}`)).status).toBe(404);
    const desktopHandle = await desktop.request('media.resolve', { projectId: project.id, path: 'notes.txt' });
    expect(desktopHandle.url.startsWith('http://')).toBe(true);
    await desktop.request('services.configure', { serviceId: 'web', readOnly: true });
    await until(() => page.state.status === 'disconnected');
    const readonlyPage = await browser(origin, cookie);
    const readonlyHandle = await readonlyPage.request('media.resolve', { projectId: project.id, path: 'notes.txt' });
    expect(await readonlyPage.request('media.playback', { url: readonlyHandle.url })).toMatchObject({ status: 'ready', media: readonlyHandle });
    await expect(readonlyPage.request('media.playback', { url: desktopHandle.url })).rejects.toMatchObject({ code: 'not-found' });
    await expect(desktop.request('media.playback', { url: handle.url })).rejects.toMatchObject({ code: 'not-found' });
    expect((await send(`${origin}${new URL(desktopHandle.url).pathname}`, { headers: { Cookie: cookie } })).status).toBe(404);
    // 项目目录之外的文件不能取。
    expect(
      details(await readonlyPage.request('media.resolve', { projectId: project.id, path: '../outside.txt' }).catch((e: unknown) => e)),
    ).not.toBeNull();
    // 本机路径（{ localPath }）只发给桌面客户端：浏览器按 Runtime 的访问范围拒绝，不扩大本机文件权限。
    const local = path.join(project.path, 'notes.txt');
    expect((await desktop.request('media.resolve', { localPath: local })).fileName).toBe('notes.txt');
    expect(details(await readonlyPage.request('media.resolve', { localPath: local }).catch((e: unknown) => e))).toMatchObject({ code: 'forbidden' });
  });

  it('构建比对（CLI 独立使用与发布 §7.4）：GET /_build 要会话，只报 Web 客户端的状态、原因与重建命令；打包的 Runtime 不比', async () => {
    // 一个假的仓库根：只有一个源文件；构建戳记下它的摘要。
    const root = path.join(dir, 'repo');
    await fs.mkdir(path.join(root, 'apps', 'web', 'src'), { recursive: true });
    const source = path.join(root, 'apps', 'web', 'src', 'main.tsx');
    await fs.writeFile(source, 'export {};');
    const stamp = (protocolVersion: string, inputs: Record<string, string>) =>
      fs.writeFile(
        path.join(dist, 'baocut-build.json'),
        JSON.stringify({ schema: 1, component: 'web', build: 'abc1234', protocolVersion, builtAt: new Date().toISOString(), outputs: ['index.html'], inputs }),
      );
    const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

    await boot({ dist }, { sourceRoot: root });
    const origin = await openWeb();
    const cookie = await login(origin);
    const builds = async () => {
      const reply = await send(`${origin}/_build`, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' } });
      expect(reply.status).toBe(200);
      expect(reply.headers['cache-control']).toBe('no-store');
      return JSON.parse(reply.body) as unknown;
    };

    expect((await send(`${origin}/_build`)).status).toBe(401);
    expect((await send(`${origin}/_build`, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    // 没有构建戳：比不了。回答里没有目录与变了的文件。
    expect(await builds()).toEqual({ builds: [{ component: 'web', state: 'unverified', reason: 'no-stamp', rebuild: 'npm run build:web' }] });
    await stamp('0.0', { 'apps/web/src/main.tsx': hash('export {};') });
    expect(await builds()).toEqual({ builds: [{ component: 'web', state: 'stale', reason: 'protocol', rebuild: 'npm run build:web' }] });
    await stamp(PROTOCOL_VERSION, { 'apps/web/src/main.tsx': hash('export {};') });
    expect(await builds()).toEqual({ builds: [] });
    await fs.writeFile(source, 'export const changed = 1;');
    expect(await builds()).toEqual({ builds: [{ component: 'web', state: 'stale', reason: 'inputs', rebuild: 'npm run build:web' }] });

    await runtime!.close();
    runtime = undefined;
    desktop.close();
    await boot({ dist });
    const packaged = await openWeb();
    const packagedCookie = await login(packaged);
    const reply = await send(`${packaged}/_build`, { headers: { Cookie: packagedCookie } });
    expect(JSON.parse(reply.body)).toEqual({ builds: [] });
  });

  it('访问代码与会话令牌不出现在 services.list、主题、日志、配置文件与审计里', async () => {
    await boot();
    const events: ServicesEvent[] = [];
    let snapshot: ServicesSnapshot | null = null;
    desktop.subscribeServices({ snapshot: (s) => (snapshot = s), event: (e) => events.push(e) });
    const origin = await openWeb();
    const unused = await accessCode();
    const code = await accessCode();
    const reply = await exchange(origin, code);
    const cookie = reply.headers['set-cookie']![0]!.split(';')[0]!;
    const secret = cookie.split('.').pop()!;
    expect(secret.length).toBeGreaterThan(20);
    const page = await browser(origin, cookie);
    await page.request('projects.create', { name: '审计' });
    await page.request('settings.set', { patch: {} } as never).catch(() => {});
    await until(() => events.length > 2);

    const web = (await desktop.request('services.list', {})).services.find((s) => s.serviceId === 'web')!;
    expect(web.recentRequests.length).toBeGreaterThan(0);
    for (const text of [
      JSON.stringify(web),
      JSON.stringify(await desktop.request('services.web.listSessions', {})),
      JSON.stringify(events),
      JSON.stringify(snapshot),
      await fs.readFile(home.servicesFile, 'utf8'),
      await fs.readFile(path.join(home.logsDir, 'runtime.log'), 'utf8'),
    ]) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain(code);
      expect(text).not.toContain(unused);
    }
  });
});

// ---- 需要真实引擎与 ffmpeg 的部分 ----

const engine = resolveEngineHostCommand();
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!engine || !ffmpeg) console.warn('跳过 Web 服务的视频测试：没有 engine-host 或 ffmpeg');

describe.skipIf(!engine || !ffmpeg)('Web 服务：浏览器里的编辑（真实引擎）', () => {
  let fixtures: string;
  let clip: string;
  let dir: string;
  let runtime: RunningRuntime;
  let desktop: BaoCutClient;
  let page: BaoCutClient;
  let project: Project;
  let videoId: Id;
  let revision: string;
  let sequenceId: Id;
  let videoPath: string;
  let origin: string;
  let pageCookie: string;
  /** 本机字体库只扫这个目录（引擎宿主启动时带上的测试钩子），放一份探针字体 ColrProbe。 */
  let systemFonts: string;
  let previousFontDirs: string | undefined;

  it('prepares transparent ProRes through the Web grant registry without exposing the original or cache paths', async () => {
    const source = path.join(project.path, 'animation.mov');
    execFileSync('ffmpeg', [
      '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red@0.5:size=162x90:rate=10:duration=1,format=rgba',
      '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-threads', '2', source,
    ]);
    const before = await fs.readFile(source);
    const handle = await page.request('media.resolve', { projectId: project.id, path: 'animation.mov' });
    expect(handle.mimeType).toBe('video/quicktime');
    const params = { url: handle.url, playable: ['vp9', 'opus'] as const };
    let result = await page.request('media.playback', { ...params, playable: [...params.playable] });
    const deadline = Date.now() + 15_000;
    while (result.status === 'pending') {
      expect(Date.now()).toBeLessThan(deadline);
      await new Promise(resolve => setTimeout(resolve, 50));
      result = await page.request('media.playback', { ...params, playable: [...params.playable] });
    }
    expect(result.media).toMatchObject({ mimeType: 'video/webm', fileName: 'animation.mov' });
    expect(result.media.url).toMatch(/^\/media\/[A-Za-z0-9_-]+\/.*\.webm$/);
    expect(result.media.url).not.toContain(project.path);
    await expect(desktop.request('media.playback', { url: result.media.url })).rejects.toMatchObject({ code: 'not-found' });
    expect(await fs.readFile(source)).toEqual(before);
  }, 25_000);

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-web-fixtures-'));
    clip = path.join(fixtures, 'clip.mp4');
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', clip],
    ]);
    systemFonts = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-web-fonts-'));
    await fs.copyFile(new URL('../../../../crates/render-raster/tests/fixtures/fonts/ColrProbe.ttf', import.meta.url), path.join(systemFonts, 'ColrProbe.ttf'));
    previousFontDirs = process.env.BAOCUT_FONT_DIRS;
    process.env.BAOCUT_FONT_DIRS = systemFonts;
  });

  afterAll(async () => {
    if (previousFontDirs === undefined) delete process.env.BAOCUT_FONT_DIRS;
    else process.env.BAOCUT_FONT_DIRS = previousFontDirs;
    await fs.rm(fixtures, { recursive: true, force: true });
    await fs.rm(systemFonts, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-web-video-'));
    const dist = path.join(dir, 'dist');
    await fs.mkdir(dist);
    await fs.writeFile(path.join(dist, 'index.html'), '<!doctype html>');
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') }),
      drivers: () => [new ToolDriver()],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      modelWorker: null,
      initiator: { discoverer: null },
      nodes: { host: '127.0.0.1', advertiser: null },
      services: { web: { dist } },
    });
    const { endpoint, token } = runtime.discovery;
    desktop = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await desktop.connect();
    await desktop.request('services.configure', { serviceId: 'web', port: 0 });
    origin = (await desktop.request('services.start', { serviceId: 'web' })).service.endpoint!.slice(0, -1);
    const { url } = await desktop.request('services.web.createAccessLink', {});
    const reply = await send(`${origin}/_auth/session`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: url.split('#code=')[1] }),
    });
    pageCookie = reply.headers['set-cookie']![0]!.split(';')[0]!;
    page = new BaoCutClient({
      resolve: async () => ({ endpoint: `${origin.replace('http:', 'ws:')}/ws`, token: '' }),
      client: { kind: 'desktop', name: 'browser', version: '0' },
      reconnect: false,
      WebSocket: browserSocket(origin, pageCookie),
    });
    await page.connect();

    ({ project } = await desktop.request('projects.create', { name: '浏览器剪辑' }));
    await fs.copyFile(clip, path.join(project.path, 'clip.mp4'));
    const created = await desktop.request('videos.create', { projectId: project.id, name: '样片' });
    await desktop.request('videos.close', { videoId: created.ref.videoId });
    videoId = created.ref.videoId;
    videoPath = created.ref.path;
    const opened = await page.request('videos.open', { projectId: project.id, path: created.ref.relPath });
    revision = opened.snapshot.video.revision;
    sequenceId = opened.snapshot.video.rootSequenceId;
  });

  afterEach(async () => {
    page.close();
    desktop.close();
    await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('直达视频的访问链接：路径与查询是 webVideoHref（项目 + 相对路径），fragment 里只有代码', async () => {
    const { url } = await desktop.request('services.web.createAccessLink', { video: videoId });
    const link = new URL(url);
    const relPath = path.relative(project.path, videoPath).split(path.sep).join('/');
    expect(link.pathname + link.search).toBe(webVideoHref({ projectId: project.id, path: relPath }));
    expect(JSON.parse(link.searchParams.get('video')!)).toEqual({ projectId: project.id, path: relPath });
    expect(link.hash).toMatch(/^#code=[A-Za-z0-9_-]+$/);
    // 浏览器断开、视频关上之后，从 Space 的登记里找到同一个位置。
    page.close();
    await until(() => runtime.videos.ref(videoId) === null);
    await runtime.space.rescan();
    await until(() => runtime.space.videos().some((video) => video.videoId === videoId), 10_000);
    const again = new URL((await desktop.request('services.web.createAccessLink', { video: videoId })).url);
    expect(again.pathname + again.search).toBe(link.pathname + link.search);
  });

  it('审片链接：同一部视频始终同一条、Runtime 重启后不变；密钥换来的会话只能看这部视频，不顶掉完整登录', async () => {
    const first = await desktop.request('services.web.reviewLink', { video: videoId });
    expect(first.autostartEnabled).toBe(true);
    expect(first.url).toMatch(new RegExp(`^${origin}/review/${videoId}#key=[A-Za-z0-9_-]{43}$`));
    const second = await desktop.request('services.web.reviewLink', { video: videoId });
    expect(second).toEqual({ ...first, autostartEnabled: false });
    expect((await desktop.request('services.list', {})).services.find((s) => s.serviceId === 'web')!.autostart).toBe(true);
    expect(details(await desktop.request('services.web.reviewLink', { video: 'vid_missing' }).catch((e: unknown) => e))).toMatchObject({
      code: 'not-found',
      details: { code: 'VIDEO_NOT_FOUND' },
    });
    const key = first.url.split('#key=')[1]!;
    const review = (body: object, headers: Record<string, string> = {}) =>
      send(`${origin}/_auth/review`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });

    // 没有会话时审片页是换密钥的脚本页；别的视频的密钥、错的密钥、别的来源都换不到。
    const before = await send(`${origin}/review/${videoId}`);
    expect(before.body).toContain('/_auth/review.js');
    expect((await review({ video: videoId, key: 'A'.repeat(43) })).status).toBe(401);
    expect((await review({ video: 'vid_other', key })).status).toBe(401);
    expect((await review({ video: videoId, key }, { Origin: 'http://evil.invalid' })).status).toBe(403);
    const reply = await review({ video: videoId, key });
    expect(reply.status).toBe(204);
    const cookie = reply.headers['set-cookie']![0]!.split(';')[0]!;
    expect(cookie).toMatch(/^baocut_review_\d+=/);
    // 密钥能反复用：同一个浏览器再换一次沿用原来的会话，不另发 cookie。
    const again = await review({ video: videoId, key }, { Cookie: cookie });
    expect(again.status).toBe(204);
    expect(again.headers['set-cookie']).toBeUndefined();

    // 审片会话：审片页给客户端页面，别的页面仍是登录页。
    expect((await send(`${origin}/review/${videoId}`, { headers: { Cookie: cookie } })).body).toBe('<!doctype html>');
    expect((await send(`${origin}/`, { headers: { Cookie: cookie } })).body).toContain('/_auth/login.js');
    expect((await send(`${origin}/review/vid_other`, { headers: { Cookie: cookie } })).body).toContain('/_auth/review.js');
    expect(JSON.parse((await send(`${origin}/_build`, { headers: { Cookie: cookie } })).body)).toEqual({ builds: [] });

    const viewer = new BaoCutClient({
      resolve: async () => ({ endpoint: `${origin.replace('http:', 'ws:')}/ws`, token: '' }),
      client: { kind: 'desktop', name: 'review', version: '0' },
      reconnect: false,
      WebSocket: browserSocket(origin, cookie),
    });
    try {
      await viewer.connect();
      const { target } = await viewer.request('videos.target', { videoId });
      const opened = await viewer.request('videos.open', target);
      expect(opened.ref.videoId).toBe(videoId);
      expect(await viewer.request('edits.undoState', { videoId })).toBeDefined();
      const scoped = (promise: Promise<unknown>) => promise.then(() => 'ok', (e: unknown) => (details(e) as { details?: { code?: string } }).details?.code);
      expect(await scoped(viewer.request('space.list', {}))).toBe('WEB_REVIEW_SCOPE');
      expect(await scoped(viewer.request('conversations.list', {}))).toBe('WEB_REVIEW_SCOPE');
      expect(await scoped(viewer.request('videos.open', { projectId: project.id, path: 'elsewhere.bcut' }))).toBe('WEB_REVIEW_SCOPE');
      expect(await scoped(viewer.request('videos.target', { videoId: 'vid_other' }))).toBe('WEB_REVIEW_SCOPE');
      expect(await scoped(viewer.request('subscribe', { topic: 'space' } as never))).toBe('WEB_REVIEW_SCOPE');
      // 预览要的本机字体：审片会话也能解析，只解析、不下载；句柄要会话，按区间取表；字体的管理仍不开放。
      const resolved = await viewer.request('fonts.resolve', {
        faces: [
          { family: 'ColrProbe', weight: 400, italic: false },
          { family: 'Nowhere Sans', weight: 700, italic: false },
        ],
        download: true,
      });
      expect(resolved.missing).toEqual([{ family: 'Nowhere Sans', weight: 700, italic: false, reason: 'not-found' }]);
      const [face] = resolved.faces;
      expect([face!.family, face!.source, face!.file.fileName]).toEqual(['ColrProbe', 'local', 'ColrProbe.ttf']);
      expect(face!.file.url).toMatch(/^\/media\/[A-Za-z0-9_-]+\//);
      const table = face!.tables.find((t) => t.length > 0)!;
      const range = { Range: `bytes=${table.from}-${table.from + table.length - 1}` };
      const part = await send(`${origin}${face!.file.url}`, { headers: { ...range, Cookie: cookie } });
      expect(part.status).toBe(206);
      expect(Number(part.headers['content-length'])).toBe(table.length);
      expect((await send(`${origin}${face!.file.url}`, { headers: range })).status).toBe(401);
      expect(await scoped(viewer.request('fonts.download', { family: 'ColrProbe' }))).toBe('WEB_REVIEW_SCOPE');
      expect(await scoped(viewer.request('fonts.catalogue', {}))).toBe('WEB_REVIEW_SCOPE');
      // 完整登录的会话不受影响。
      expect((await page.request('space.list', {})).entries).toBeDefined();
      expect((await page.request('fonts.resolve', { faces: [{ family: 'ColrProbe', weight: 400, italic: false }] })).faces).toHaveLength(1);
    } finally {
      viewer.close();
    }

    // Runtime 重启（服务随 Runtime 启动；测试里端口是系统挑的，先把它固定下来）：同一条链接，密钥照样能换。
    const port = new URL(origin).port;
    await desktop.request('services.configure', { serviceId: 'web', port: Number(port) });
    await runtime.close();
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') }),
      drivers: () => [new ToolDriver()],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      modelWorker: null,
      initiator: { discoverer: null },
      nodes: { host: '127.0.0.1', advertiser: null },
      services: { web: { dist: path.join(dir, 'dist') } },
    });
    expect(runtime.services.manager.status('web')).toMatchObject({ state: 'on' });
    await runtime.space.rescan();
    await until(() => runtime.space.videos().some((video) => video.videoId === videoId), 10_000);
    expect(runtime.services.manager.status('web').endpoint).toBe(`http://127.0.0.1:${port}/`);
    expect((await runtime.services.web.reviewLink(videoId)).url).toBe(first.url);
    expect((await review({ video: videoId, key })).status).toBe(204);
  });

  it('审片页的导出：只能导这部视频的 MP4 成片、不带位置；只看得到、取消得了、下载得了自己起的导出', async () => {
    await page.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: revision,
      operations: [
        { type: 'importAsset', path: path.join(project.path, 'clip.mp4'), ref: 'c' },
        { type: 'addItem', sequenceId, asset: { ref: 'c' }, alignment: 'nearest-frame' },
      ],
    });
    const { url } = await desktop.request('services.web.reviewLink', { video: videoId });
    const reply = await send(`${origin}/_auth/review`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ video: videoId, key: url.split('#key=')[1]! }),
    });
    const cookie = reply.headers['set-cookie']![0]!.split(';')[0]!;
    const settled = (client: BaoCutClient, jobId: string) =>
      until(async () => {
        const record = await client.request('exports.get', { jobId });
        return ['completed', 'failed', 'cancelled', 'interrupted'].includes(record.state) && record;
      }, 60_000);

    // 完整会话也能下载：302 到带 download=1 的媒体句柄，取到的是附件。
    const { jobId: fullJob } = await page.request('exports.create', { videoId, settings: { kind: 'audio', format: 'wav' } });
    expect((await settled(page, fullJob)).state).toBe('completed');
    const fullDownload = await send(`${origin}${webExportDownloadPath(fullJob, 0)}`, { headers: { Cookie: pageCookie } });
    expect(fullDownload.status).toBe(302);
    expect(fullDownload.headers.location).toMatch(/^\/media\/[A-Za-z0-9_-]+\/.+\.wav\?download=1$/);
    const file = await send(`${origin}${fullDownload.headers.location}`, { headers: { Cookie: pageCookie } });
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toMatch(/^attachment; filename\*=UTF-8''.+\.wav$/);
    expect((await send(`${origin}${webExportDownloadPath(fullJob, 1)}`, { headers: { Cookie: pageCookie } })).status).toBe(404);
    expect((await send(`${origin}${webExportDownloadPath(fullJob, 0)}`)).status).toBe(401);

    const viewer = new BaoCutClient({
      resolve: async () => ({ endpoint: `${origin.replace('http:', 'ws:')}/ws`, token: '' }),
      client: { kind: 'desktop', name: 'review', version: '0' },
      reconnect: false,
      WebSocket: browserSocket(origin, cookie),
    });
    try {
      await viewer.connect();
      const scoped = (promise: Promise<unknown>) => promise.then(() => 'ok', (e: unknown) => (details(e) as { details?: { code?: string } }).details?.code);
      const video = { kind: 'video', format: 'mp4' } as const;
      // 只有这部视频的 MP4 成片，不带位置、不是内部预览。
      for (const request of [
        { videoId, settings: { kind: 'audio', format: 'wav' } },
        { videoId, settings: { kind: 'video', format: 'webm' } },
        { videoId, settings: { ...video, purpose: 'preview' } },
        { videoId, settings: video, destination: { dir: project.path } },
        { videoId, settings: video, destination: { fileName: 'x.mp4' } },
        { videoId, settings: video, destination: { overwrite: true } },
        { videoId: 'vid_other', settings: video },
      ]) {
        expect(await scoped(viewer.request('exports.create', request as never)), JSON.stringify(request)).toBe('WEB_REVIEW_SCOPE');
      }
      // 别人起的导出：看不到、取消不了、下载不了；列表要带这部视频，只列自己起的。
      expect(await scoped(viewer.request('exports.get', { jobId: fullJob }))).toBe('WEB_REVIEW_SCOPE');
      expect(await scoped(viewer.request('jobs.cancel', { jobId: fullJob }))).toBe('WEB_REVIEW_SCOPE');
      expect(await scoped(viewer.request('exports.list', {}))).toBe('WEB_REVIEW_SCOPE');
      expect(await scoped(viewer.request('subscribe', { topic: 'jobs' } as never))).toBe('WEB_REVIEW_SCOPE');
      expect((await viewer.request('exports.list', { videoId })).jobs).toEqual([]);
      expect((await send(`${origin}${webExportDownloadPath(fullJob, 0)}`, { headers: { Cookie: cookie } })).status).toBe(404);

      // 浏览器没有保存窗口，界面给的是空的位置（照 Runtime 的缺省）：放行。
      const { jobId } = await viewer.request('exports.create', { videoId, settings: { ...video, width: 320, height: 180 }, destination: {} });
      expect((await viewer.request('exports.list', { videoId })).jobs.map((job) => job.jobId)).toEqual([jobId]);
      const job = await settled(viewer, jobId);
      expect(job.export!.destination.dir).toBe(await fs.realpath(path.join(project.path, 'exports')));
      if (resolveExportWorkerCommand(engine)) {
        expect(job.state, JSON.stringify(job.error)).toBe('completed');
        const own = await send(`${origin}${webExportDownloadPath(jobId, 0)}`, { headers: { Cookie: cookie } });
        expect(own.status).toBe(302);
        expect(own.headers.location).toMatch(/\.mp4\?download=1$/);
        expect((await send(`${origin}${own.headers.location}`, { headers: { Cookie: cookie } })).status).toBe(200);
      }
      // 取消认自己起的任务（已经结束的不再变）。
      expect(await scoped(viewer.request('jobs.cancel', { jobId }))).toBe('ok');
    } finally {
      viewer.close();
    }
  }, 90_000);

  it('写入的操作者是用户本人（与桌面相同），不是 external:web；项目目录之外的素材文件被拒绝', async () => {
    const applied = await page.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: revision,
      label: '放入 clip.mp4',
      operations: [
        { type: 'importAsset', path: path.join(project.path, 'clip.mp4'), ref: 'c' },
        { type: 'addItem', sequenceId, asset: { ref: 'c' }, alignment: 'nearest-frame' },
      ],
    });
    const { entries } = await desktop.request('videos.history', { videoId });
    const entry = entries.find((e) => e.transactionId === applied.receipt.transactionId)!;
    expect(entry.actor).toEqual({ kind: 'user', id: 'user_local' });

    const outside = path.join(fixtures, 'clip.mp4');
    for (const file of [outside, path.relative(path.join(project.path, '样片'), outside), '../../outside.mp4']) {
      const error = await page
        .request('edits.apply', {
          videoId,
          commandId: newId('cmd'),
          expectedRevision: applied.receipt.videoRevision,
          operations: [{ type: 'importAsset', path: file }],
        })
        .catch((e: unknown) => e);
      expect(details(error), file).toMatchObject({ code: 'forbidden', details: { code: 'PATH_OUTSIDE_PROJECT', index: 0 } });
    }
    // 桌面能撤销浏览器里的编辑：同一个用户、同一条撤销栈。
    expect((await desktop.request('edits.undoState', { videoId })).undo).toEqual({
      transactionId: applied.receipt.transactionId,
      label: '放入 clip.mp4',
    });
    const web = (await desktop.request('services.list', {})).services.find((s) => s.serviceId === 'web')!;
    expect(web.recentRequests[0]).toMatchObject({ tool: 'edits.apply', videoId, outcome: 'PATH_OUTSIDE_PROJECT' });
  });

  it('导出：目标目录只能在项目目录里，不能是视频目录，不能经符号链接出去；项目里的目录照常导出', async () => {
    await page.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: revision,
      operations: [
        { type: 'importAsset', path: path.join(project.path, 'clip.mp4'), ref: 'c' },
        { type: 'addItem', sequenceId, asset: { ref: 'c' }, alignment: 'nearest-frame' },
      ],
    });
    const settings = { kind: 'audio', format: 'wav' } as const;
    await fs.symlink(fixtures, path.join(project.path, 'link'));
    // 成片与其他种类走同一条目录约束（在导出服务之前）。
    const video = { kind: 'video', format: 'mp4' } as const;
    const portable = { kind: 'portable' } as const;
    const xmeml = { kind: 'project', format: 'xmeml' } as const;
    for (const dir of [fixtures, path.join(project.path, '..'), '..', 'link', path.join(project.path, 'link'), videoPath]) {
      for (const s of [settings, video, portable, xmeml]) {
        const error = await page.request('exports.create', { videoId, settings: s, destination: { dir } }).catch((e: unknown) => e);
        expect(details(error), `${s.kind} ${dir}`).toMatchObject({ code: 'forbidden', details: { code: 'PATH_OUTSIDE_PROJECT' } });
      }
    }
    expect(await fs.readdir(fixtures)).toEqual(['clip.mp4']);
    const missing = await page
      .request('exports.create', { videoId, settings, destination: { dir: path.join(project.path, '没有') } })
      .catch((e: unknown) => e);
    expect(details(missing)).toMatchObject({ details: { code: 'EXPORT_DESTINATION_UNWRITABLE' } });

    await fs.mkdir(path.join(project.path, '成片'));
    for (const destination of [{ dir: path.join(project.path, '成片'), fileName: '声音.wav' }, { dir: '成片' }, undefined]) {
      const { jobId } = await page.request('exports.create', { videoId, settings, ...(destination ? { destination } : {}) });
      const job = await until(async () => {
        const record = await page.request('exports.get', { jobId });
        return ['completed', 'failed', 'cancelled'].includes(record.state) && record;
      });
      expect(job.state, JSON.stringify(job.error)).toBe('completed');
      const dir = await fs.realpath(path.join(project.path, destination ? '成片' : 'exports'));
      expect(job.export!.destination.dir).toBe(dir);
    }
    expect((await fs.readdir(path.join(project.path, '成片'))).length).toBe(2);
    const web = (await desktop.request('services.list', {})).services.find((s) => s.serviceId === 'web')!;
    expect(web.recentRequests.some((r) => r.tool === 'exports.create' && r.outcome === 'PATH_OUTSIDE_PROJECT')).toBe(true);
  });

  it('Space：浏览器只能登记项目目录里的文件（不能经符号链接出去）；项目里的照常登记；能读能搜', async () => {
    await fs.symlink(fixtures, path.join(project.path, 'outside-link'));
    const outside = path.join(fixtures, 'clip.mp4');
    for (const file of [outside, path.relative(project.path, outside), 'outside-link/clip.mp4', project.path]) {
      const error = await page.request('space.import', { projectId: project.id, path: file }).catch((e: unknown) => e);
      expect(details(error), file).toMatchObject({ code: 'forbidden', details: { code: 'PATH_OUTSIDE_PROJECT' } });
    }
    expect(await fs.readdir(project.path)).not.toContain('imports');
    const { entry, copied } = await page.request('space.import', { projectId: project.id, path: 'clip.mp4', name: '原片' });
    expect(copied).toBe(false);
    expect(entry).toMatchObject({ relPath: 'clip.mp4', name: '原片', origin: { source: 'imported', projectId: project.id } });
    const listed = await page.request('space.list', { projectId: project.id, kind: 'video-file' });
    expect(listed.entries.map((e) => e.id)).toContain(entry.id);
    expect(await page.request('space.search', { query: '没有这句话' })).toMatchObject({ hits: [] });
    const web = (await desktop.request('services.list', {})).services.find((s) => s.serviceId === 'web')!;
    expect(web.recentRequests.some((r) => r.tool === 'space.import' && r.outcome === 'PATH_OUTSIDE_PROJECT')).toBe(true);
  });

  it('便携包：浏览器只能打开项目目录里的包（不能经符号链接出去）；项目里的照常建成新视频', async () => {
    // 桌面把包导出到项目之外。
    const outside = path.join(dir, 'outside');
    await fs.mkdir(outside);
    const { jobId } = await desktop.request('exports.create', { videoId, settings: { kind: 'portable' }, destination: { dir: outside } });
    const job = await until(async () => {
      const record = await desktop.request('exports.get', { jobId });
      return ['completed', 'failed', 'cancelled'].includes(record.state) && record;
    });
    expect(job.state, JSON.stringify(job.error)).toBe('completed');
    const file = job.result!.outputs![0]!.path!;
    await fs.symlink(outside, path.join(project.path, 'outside-link'));
    const before = await fs.readdir(project.path);
    for (const target of [file, path.relative(project.path, file), `outside-link/${path.basename(file)}`, project.path]) {
      const error = await page.request('videos.importPackage', { projectId: project.id, path: target }).catch((e: unknown) => e);
      expect(details(error), target).toMatchObject({ code: 'forbidden', details: { code: 'PATH_OUTSIDE_PROJECT' } });
    }
    expect(await fs.readdir(project.path)).toEqual(before);
    const web = (await desktop.request('services.list', {})).services.find((s) => s.serviceId === 'web')!;
    expect(web.recentRequests.some((r) => r.tool === 'videos.importPackage' && r.outcome === 'PATH_OUTSIDE_PROJECT')).toBe(true);

    await fs.copyFile(file, path.join(project.path, '样片.baocut'));
    const opened = await page.request('videos.importPackage', { projectId: project.id, path: '样片.baocut' });
    expect(opened.ref.videoId).not.toBe(videoId);
    expect(path.dirname(opened.ref.path)).toBe(await fs.realpath(project.path));
  });
});

// ---- 真实的构建产物（npm run build:web 之后）：入口页引用的脚本与样式都能取到 ----

const built = resolveWebDist({});
if (!built) console.warn('跳过 Web 客户端构建产物的冒烟测试：没有 apps/web/dist（先运行 npm run build:web）');

describe.skipIf(!built)('Web 服务：真实的构建产物', () => {
  it('登录后入口页引用的资源都能取到，类型正确，没有内联脚本', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-web-built-'));
    const runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: dir }),
      drivers: () => [new ToolDriver()],
      watchSpace: false,
      engineHost: null,
      modelWorker: null,
      initiator: { discoverer: null },
      nodes: { host: '127.0.0.1', advertiser: null },
      services: { web: { dist: built } },
    });
    const { endpoint, token } = runtime.discovery;
    const desktop = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    try {
      await desktop.connect();
      await desktop.request('services.configure', { serviceId: 'web', port: 0 });
      const origin = (await desktop.request('services.start', { serviceId: 'web' })).service.endpoint!.slice(0, -1);
      const { url } = await desktop.request('services.web.createAccessLink', {});
      const login = await send(`${origin}/_auth/session`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: url.split('#code=')[1] }),
      });
      const cookie = login.headers['set-cookie']![0]!.split(';')[0]!;
      const index = await send(`${origin}/`, { headers: { Cookie: cookie } });
      expect(index.status).toBe(200);
      expect(index.body).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
      const assets = [...index.body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]!);
      expect(assets.some((a) => a.endsWith('.js'))).toBe(true);
      expect(assets.some((a) => a.endsWith('.css'))).toBe(true);
      for (const asset of assets) {
        const reply = await send(`${origin}${asset}`, { headers: { Cookie: cookie } });
        expect(reply.status, asset).toBe(200);
        expect(reply.headers['content-type'], asset).toMatch(asset.endsWith('.js') ? /^text\/javascript/ : /^text\/css/);
      }
    } finally {
      desktop.close();
      await runtime.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
