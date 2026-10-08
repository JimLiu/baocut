import crypto from 'node:crypto';
import fs from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import {
  RpcError,
  WEB_DEFAULT_METHODS,
  methodMatches,
  nowIso,
  type RpcMethod,
  type RuntimeInfo,
  type ServiceConfigureParams,
  type ServiceRequestRecord,
  type WebAccessLink,
  type WebServiceAccess,
  type WebSession,
} from '@baocut/protocol';
import { RcWeb } from '@baocut/protocol/messages/runtime-core';
import type { Harness, Logger } from '@baocut/harness';
import { Gateway, type TrustedPrincipal } from '../gateway.ts';
import type { RpcHandlers } from '../handlers.ts';
import { MediaRegistry } from '../media.ts';
import type { VideoService } from '../videos/video-service.ts';
import type { ServiceConfigStore } from './service-config-store.ts';
import { listenError } from './service-clients.ts';
import type { ManagedService, ServiceReport } from './service-manager.ts';
import { webAuthorize, webHandlers } from './web-handlers.ts';
import { WebSessions, type WebSessionsOptions } from './web-sessions.ts';
import { resolveWebDist, sendLoginPage, sendLoginScript, sendStatic, setSecurityHeaders } from './web-static.ts';

/**
 * Web 服务（架构设计 §4.8、§12.8）：本机浏览器里的客户端。一个回环端口上提供三样东西：
 *
 * - Web 客户端的静态文件（构建产物；没有构建时服务进入 `error`，不影响 Runtime）；
 * - 网关入口 `/ws`：与桌面界面同一套协议与处理函数，但连接在升级时按会话 cookie 认证，方法与主题按白名单过滤；
 *   主体是 `{ kind: 'web', sessionId }`，写入的操作者是用户本人（`user_local`）；
 * - 媒体通道 `/media/…`：这个服务自己的句柄表（同源的相对地址），取内容还要会话 cookie；不暴露桌面网关的端口与令牌。
 *
 * 登录：`createAccessLink` 发一个一次性代码，放在链接的 fragment 里（或由用户粘进登录页的输入框）；
 * 登录页的脚本用它 `POST /_auth/session` 换一个 HttpOnly、SameSite=Strict 的会话 cookie。选 cookie 而不是页面内存里的令牌：`<video>`、`<img>` 不能带请求头，
 * 只有 cookie 能让媒体请求与 WebSocket 用同一个会话认证、吊销时一起失效，令牌也不进 URL；HttpOnly 让页面脚本读不到它。
 * 回环地址上的 cookie 不按端口隔离（本机其他端口的服务也会收到），所以名字带端口，WebSocket 与登录另外要求 Origin 是自己。
 *
 * 来源检查：`Host` 必须是 `127.0.0.1:<端口>` 或 `localhost:<端口>`（DNS 重绑定）；带 `Origin` 的请求只接受这两个来源，
 * WebSocket 与登录必须带；浏览器给了 `Sec-Fetch-Site` 时，需要会话的请求只接受 `same-origin` 与 `none`。
 */

const HOST = '127.0.0.1';
const RECENT_LIMIT = 20;
const MAX_AUTH_BODY = 1024;

export interface WebServiceDeps {
  store: ServiceConfigStore;
  harness: Harness;
  videos: VideoService;
  log: Logger;
  /** 会话或最近的请求变了：送一条 `service.updated`。 */
  onChange: () => void;
  /** 构建产物目录。不给时按 `resolveWebDist()` 找；null 表示没有（服务开启时进入 `error`）。 */
  dist?: string | null;
  sessions?: WebSessionsOptions;
}

export class WebService implements ManagedService {
  readonly id = 'web' as const;
  get label(): string {
    return RcWeb.serviceLabel().text;
  }
  readonly available = true;
  /** 浏览器用的媒体句柄：同源的相对地址，只在这个服务的端口上、带会话时可取。 */
  readonly media: MediaRegistry;
  readonly #deps: WebServiceDeps;
  readonly #log: Logger;
  readonly #sessions: WebSessions;
  readonly #uploads = new Map<string, { sessionId: string; url: string; expires: number }>();
  #binding: { handlers: RpcHandlers; runtime: RuntimeInfo } | null = null;
  #server: Server | null = null;
  #gateway: Gateway | null = null;
  #port: number | null = null;
  #dist: string | null = null;
  #recent: ServiceRequestRecord[] = [];

  constructor(deps: WebServiceDeps) {
    this.#deps = deps;
    this.#log = deps.log.child('web-service');
    this.#sessions = new WebSessions(deps.sessions);
    this.media = new MediaRegistry({ log: deps.log, originAllowed: (origin) => origin !== undefined && this.#origins().includes(origin) });
  }

  /** Runtime 装配好网关之后交给它处理函数（用这个服务的媒体句柄表构造的那一组）。在这之前不能开启。 */
  bind(binding: { handlers: RpcHandlers; runtime: RuntimeInfo }): void {
    this.#binding = {
      runtime: binding.runtime,
      handlers: webHandlers(binding.handlers, {
        harness: this.#deps.harness,
        videos: this.#deps.videos,
        record: (method, principal, videoId, outcome) => this.#audit(method, principal, videoId, outcome),
        access: () => this.#access(),
        uploadUrl: (sessionId, url) => {
          for (const [key, item] of this.#uploads) if (item.expires < Date.now()) this.#uploads.delete(key);
          const key = crypto.randomBytes(32).toString('base64url');
          this.#uploads.set(key, { sessionId, url, expires: Date.now() + 10 * 60_000 });
          return `/attachments/${key}`;
        },
      }),
    };
  }

  async start(): Promise<void> {
    if (this.#server) return;
    if (!this.#binding) throw new Error(RcWeb.runtimeNotReady().text);
    const dist = this.#deps.dist !== undefined ? this.#deps.dist : resolveWebDist();
    if (!dist || !fs.existsSync(path.join(dist, 'index.html'))) {
      throw new Error(RcWeb.clientNotBuilt().text);
    }
    const port = this.#deps.store.get('web').port;
    const gateway = new Gateway({
      // 浏览器连接在升级时就认证过；这个令牌从不发出，只是让没有会话的连接无论如何过不了 hello。
      token: crypto.randomBytes(32).toString('base64url'),
      runtime: this.#binding.runtime,
      handlers: this.#binding.handlers,
      log: this.#deps.log,
      authorize: (method, params, principal) => this.#authorize(method, params, principal),
      onConnect: (principal) => {
        if (principal.sessionId) this.#sessions.connected(principal.sessionId, 1);
      },
      onDisconnect: (principal) => {
        if (principal.sessionId) this.#sessions.connected(principal.sessionId, -1);
        this.#deps.videos.connectionClosed(principal.connectionId);
      },
    });
    const server = createServer((request, response) => this.#request(request, response));
    server.on('upgrade', (request, socket, head) => this.#upgrade(request, socket, head));
    await new Promise<void>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        reject(listenError(port, error));
      });
      server.listen(port, HOST, () => resolve());
    });
    server.on('error', (error) => this.#log.warn('Web service error', { error: String(error) }));
    this.#server = server;
    this.#gateway = gateway;
    this.#dist = dist;
    this.#port = (server.address() as AddressInfo).port;
    this.#log.info('Web service listening', { port: this.#port });
  }

  async stop(): Promise<void> {
    const server = this.#server;
    const gateway = this.#gateway;
    this.#server = null;
    this.#gateway = null;
    this.#port = null;
    // 会话与代码随服务作废（§12.8：令牌在服务每次启动时重新生成）。
    this.#sessions.clear();
    await gateway?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  status(): ServiceReport {
    const config = this.#deps.store.get('web');
    const port = this.#port ?? config.port;
    return {
      autostart: config.autostart,
      port,
      endpoint: this.#server ? `http://${HOST}:${port}/` : null,
      policy: null,
      clients: this.#sessions
        .list()
        .map((s) => ({ clientId: s.sessionId, name: RcWeb.browserSession().text, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt })),
      recentRequests: this.#recent.map((r) => ({ ...r })),
      web: this.#access(),
    };
  }

  async applyConfig(params: ServiceConfigureParams): Promise<boolean> {
    if (params.level !== undefined || params.videos !== undefined) {
      throw new RpcError('invalid-request', RcWeb.noLevelOrScope());
    }
    if (params.methods) {
      const wider = params.methods.filter((p) => !withinDefault(p));
      if (wider.length > 0) {
        throw new RpcError('invalid-request', RcWeb.allowlistTooWide({ methods: wider.join(RcWeb.listSeparator().text) }), {
          methods: wider,
        });
      }
    }
    const before = this.#deps.store.get('web');
    const access = this.#access();
    const next: WebServiceAccess = {
      readOnly: params.readOnly ?? access.readOnly,
      methods: params.methods === undefined ? access.methods : params.methods === null ? null : [...new Set(params.methods)],
    };
    await this.#deps.store.update('web', {
      ...(params.autostart !== undefined ? { autostart: params.autostart } : {}),
      ...(params.port !== undefined ? { port: params.port } : {}),
      web: next,
    });
    // 能力集合变了：断开已有的浏览器连接，让它们按新的白名单重新订阅（已订阅的主题可能不再允许）。
    if (JSON.stringify(next) !== JSON.stringify(access)) this.#gateway?.disconnectWhere(() => true, 'access changed');
    return params.port !== undefined && params.port !== before.port;
  }

  // ---- 访问链接与会话 ----

  /** `href` 是链接的路径与查询（`webVideoHref` 的结果，以 `/` 开头）；不给时是根路径。代码只在 fragment 里。 */
  createAccessLink(href = '/'): WebAccessLink {
    if (!this.#server || this.#port === null) {
      throw new RpcError('conflict', RcWeb.notRunning(), {
        code: 'SERVICE_NOT_RUNNING',
        serviceId: 'web',
      });
    }
    if (!href.startsWith('/') || href.includes('#')) throw new RpcError('invalid-request', RcWeb.invalidAccessPath());
    const { code, expiresAt } = this.#sessions.issueCode();
    this.#log.info('Issued access link', { expiresAt });
    return { url: `http://${HOST}:${this.#port}${href}#code=${code}`, expiresAt };
  }

  listSessions(): WebSession[] {
    return this.#sessions.list();
  }

  revokeSession(sessionId: string): WebSession[] {
    if (!this.#sessions.revoke(sessionId)) throw new RpcError('not-found', RcWeb.sessionNotFound());
    this.#gateway?.disconnectWhere((p) => p.sessionId === sessionId, 'session revoked');
    this.#log.info('Revoked browser session', { sessionId });
    this.#deps.onChange();
    return this.listSessions();
  }

  // ---- 请求 ----

  #access(): WebServiceAccess {
    return this.#deps.store.get('web').web ?? { readOnly: false, methods: null };
  }

  #origins(): string[] {
    return this.#port === null ? [] : [`http://127.0.0.1:${this.#port}`, `http://localhost:${this.#port}`];
  }

  #hostAllowed(host: string | undefined): boolean {
    return this.#port !== null && (host === `127.0.0.1:${this.#port}` || host === `localhost:${this.#port}`);
  }

  /** 请求带的会话（cookie）；没有或无效时为 null。 */
  #session(request: IncomingMessage): string | null {
    const token = readCookie(request.headers.cookie, cookieName(this.#port));
    return token ? this.#sessions.verify(token) : null;
  }

  #authorize(method: RpcMethod, params: unknown, principal: TrustedPrincipal): RpcError | null {
    if (!principal.sessionId || !this.#sessions.alive(principal.sessionId)) {
      // 先回答这个请求（说明会话失效），再断开连接。
      setImmediate(() => this.#gateway?.disconnectWhere((p) => p.connectionId === principal.connectionId, 'session expired'));
      return new RpcError('unauthenticated', RcWeb.sessionExpired());
    }
    return webAuthorize(method, params, this.#access());
  }

  #upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on('error', () => socket.destroy());
    const refuse = (status: number, text: string) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    const gateway = this.#gateway;
    if (!gateway) return refuse(503, 'Service Unavailable');
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    if (pathname !== '/ws') return refuse(404, 'Not Found');
    // WebSocket 不受同源策略限制：来源必须带、必须是自己。
    const origin = request.headers.origin;
    if (!this.#hostAllowed(request.headers.host) || origin === undefined || !this.#origins().includes(origin)) {
      this.#log.warn('Refused WebSocket origin', { origin });
      return refuse(403, 'Forbidden');
    }
    const sessionId = this.#session(request);
    if (!sessionId) return refuse(401, 'Unauthorized');
    gateway.upgrade(request, socket, head, { kind: 'web', name: 'web', sessionId });
  }

  #request(request: IncomingMessage, response: ServerResponse): void {
    setSecurityHeaders(response);
    const deny = (status: number, text: string) => response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text);
    if (!this.#hostAllowed(request.headers.host)) return void deny(403, RcWeb.loopbackOnly().text);
    const origin = request.headers.origin;
    if (origin !== undefined && !this.#origins().includes(origin)) return void deny(403, RcWeb.originRejected().text);
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');

    if (pathname === '/_auth/session') return void this.#login(request, response).catch(() => deny(500, RcWeb.loginFailed().text));
    if (pathname.startsWith('/attachments/')) {
      const session = this.#session(request),
        item = this.#uploads.get(pathname.slice('/attachments/'.length));
      if (
        !origin ||
        !session ||
        !item ||
        item.sessionId !== session ||
        item.expires < Date.now() ||
        webAuthorize('attachments.prepare', {}, this.#access())
      )
        return void deny(403, RcWeb.originRejected().text);
      if (request.method !== 'PUT') return void deny(405, 'Method Not Allowed');
      this.#uploads.delete(pathname.slice('/attachments/'.length));
      const target = new URL(item.url);
      if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname))
        return void deny(403, RcWeb.originRejected().text);
      const upstream = httpRequest(
        target,
        {
          method: 'PUT',
          headers: {
            'Content-Type': request.headers['content-type'] ?? 'application/octet-stream',
            ...(request.headers['content-length'] ? { 'Content-Length': request.headers['content-length'] } : {}),
          },
        },
        (result) => {
          response.writeHead(result.statusCode ?? 502, { 'Cache-Control': 'no-store' });
          result.on('error', () => response.destroy());
          result.pipe(response);
        },
      );
      upstream.on('error', () => {
        if (!response.headersSent) deny(502, RcWeb.readFailed().text);
        else response.destroy();
      });
      request.on('aborted', () => upstream.destroy());
      request.pipe(upstream);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return void response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    }
    if (pathname === '/_auth/login.js') return sendLoginScript(request, response);

    // 需要会话的内容：别的站点（含本机其他端口）发起的请求不给。
    const site = request.headers['sec-fetch-site'];
    const sameOrigin = site === undefined || site === 'same-origin' || site === 'none';
    const session = sameOrigin ? this.#session(request) : null;
    // 界面内链接（`/home?video=…` 这类，没有扩展名）与根路径一样：没登录给登录页，登录了给客户端页面，由客户端按路径与查询去对应的界面。
    const page = pathname === '/' || pathname === '/index.html' || isAppRoute(pathname);
    if (page) {
      if (!session) return sendLoginPage(request, response);
    } else if (!session) {
      return void deny(sameOrigin ? 401 : 403, RcWeb.loginRequired().text);
    }
    if (pathname.startsWith('/media/')) {
      if (!this.media.handle(request, response)) deny(404, RcWeb.fileNotFound().text);
      return;
    }
    void sendStatic(this.#dist!, page ? '/' : pathname, this.#port!, request, response).catch(() => {
      if (!response.headersSent) deny(500, RcWeb.readFailed().text);
      else response.destroy();
    });
  }

  /** `POST /_auth/session { code }`：代码换会话 cookie。来源必须带、必须是自己。 */
  async #login(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') return void response.writeHead(405, { Allow: 'POST' }).end();
    const origin = request.headers.origin;
    if (origin === undefined || !this.#origins().includes(origin)) return void response.writeHead(403).end();
    if (!(request.headers['content-type'] ?? '').startsWith('application/json')) return void response.writeHead(415).end();
    const body = await readBody(request, MAX_AUTH_BODY);
    let code: unknown;
    try {
      code = body === null ? undefined : (JSON.parse(body) as { code?: unknown }).code;
    } catch {
      code = undefined;
    }
    const issued = typeof code === 'string' ? this.#sessions.exchange(code, request.headers['user-agent']) : null;
    if (!issued) {
      this.#log.info('Access code exchange failed');
      response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'ACCESS_CODE_INVALID' }));
      return;
    }
    this.#log.info('Browser session established', { sessionId: issued.sessionId });
    this.#deps.onChange();
    response
      .writeHead(204, {
        'Set-Cookie': `${cookieName(this.#port)}=${issued.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${issued.maxAgeSec}`,
      })
      .end();
  }

  #audit(method: RpcMethod, principal: TrustedPrincipal, videoId: string | null, outcome: string): void {
    const record: ServiceRequestRecord = {
      at: nowIso(),
      clientId: principal.sessionId ?? principal.connectionId,
      clientName: RcWeb.browserSession().text,
      tool: method,
      videoId,
      outcome,
    };
    this.#recent = [record, ...this.#recent].slice(0, RECENT_LIMIT);
    this.#log.info('External request', { serviceId: 'web', clientId: record.clientId, tool: method, videoId, outcome });
    this.#deps.onChange();
  }
}

/**
 * 客户端的界面内链接（`/home`、`/c/<会话>`、`/space/<分类>` 这类，`packages/ui` 的 `hrefFor`）：最后一段没有扩展名，
 * 不在媒体、登录与构建产物的路径下。它们没有对应的文件，一律给客户端页面（`index.html`）。
 */
function isAppRoute(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0 || ['media', '_auth', 'assets', 'ws'].includes(parts[0]!)) return false;
  return parts.every((part) => !part.startsWith('.')) && !parts[parts.length - 1]!.includes('.');
}

/** cookie 的名字带端口：回环地址上的 cookie 不按端口隔离，不同端口（不同 Runtime Home）的会话不互相覆盖。 */
function cookieName(port: number | null): string {
  return `baocut_web_${port ?? 0}`;
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** 配置的白名单项是否在默认集合之内：方法名要被默认集合覆盖，`x.*` 要落在默认集合的某个 `y.*` 之内。 */
function withinDefault(pattern: string): boolean {
  if (!pattern.endsWith('.*')) return WEB_DEFAULT_METHODS.some((p) => methodMatches(p, pattern));
  return WEB_DEFAULT_METHODS.some((p) => p.endsWith('.*') && pattern.startsWith(p.slice(0, -1)));
}

function readBody(request: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}
