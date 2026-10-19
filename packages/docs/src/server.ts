/**
 * 文档的 HTTP 路由与 WebSocket 升级（docs/design/docs §6.2）：
 *
 *   /docs/<grant>/                     编辑器页面（注入 `<base href="/docs/<grant>/">` 与 `__BAOCUT_DOCS__`，shim 把地址换成 project/<id>）
 *   /docs/<grant>/project/<id>         同上（刷新、直接打开）
 *   /docs/<grant>/assets/…、artifact-type/…  编辑器的构建产物（apps/docs-editor/dist），防路径穿越
 *   /docs/<grant>/api/…                编辑器的启动接口、素材上传与读取
 *   /docs/<grant>/api/mux              WebSocket：door 调用与推送（mux.ts）
 *
 * grant 是不可猜的凭证，只在内存里；同一个目录（真实路径）复用同一个 grant。同一个目录在内存里只有一份 `LiveDoc`，
 * 编辑器的连接与智能体的连接器（connector.ts）都经它的 door 读写；文档的变化推给开着这份文档的编辑器。
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import type { DocsConnectorHost } from './connector.ts';
import { DocDoor, LOCAL_PRINCIPAL, SERVER_CAPS, fileValue, humanActor, projectValue, type DoorContext, type DoorUser } from './door.ts';
import { AGENT_VIA, type DoorRequest } from './door-types.ts';
import { LiveDoc, type DocEvent, type DocEventActor } from './live-doc.ts';
import { MuxServer, type MuxConnection, type TopicHandler } from './mux.ts';
import { serializeDocument } from './prose-xml.ts';
import { loadDocState, visibleTabs, type DocState } from './store.ts';
import { historyRows, sameBlocks, versionBlocks, versionNumbered } from './versions.ts';

export interface DocsRouteOptions {
  /** 能不能写（Web 服务的只读会话为 false）：door 的写入回 `forbidden`，素材上传回 403。 */
  canEdit: boolean;
  /** CSP 的 frame-ancestors 来源列表；不给时不限制（网关：grant 本身就是凭证，桌面界面是 file:// 页面）。 */
  frameAncestors?: string;
}

export interface DocsServerOptions {
  /** 编辑器构建产物目录；返回 null 时页面回 503。每次请求都问，构建后不用重启。 */
  editorDist: () => string | null;
  /** 编辑器里本机用户的显示名。 */
  userName?: () => string | undefined;
  onError?: (message: string, error: unknown) => void;
  onWarn?: (message: string) => void;
  /** 同时打开的文档上限，超过时丢掉最早打开、没有编辑器连着的。 */
  maxDocs?: number;
  /** 现在的时间（毫秒）：版本按它分段，测试换成假的钟。 */
  now?: () => number;
}

interface OpenDoc {
  grant: string;
  dir: string;
  mux: MuxServer | undefined;
}

const GRANT_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
/** 编辑器上传素材的上限。 */
const MAX_BLOB_BYTES = 64 * 1024 * 1024;
/** door 调用的 HTTP 请求体上限（编辑器平时走 mux，HTTP 是它的后备）。 */
const MAX_DOOR_BYTES = 32 * 1024 * 1024;
/** chat 主题的空闲帧：没有它，编辑器会在 45 秒后提示与服务器断开。 */
const IDLE_CHAT_FRAME = { messages: [], status: { text: '', ts: 0 }, running: false, full: true };
const CHAT_KEEPALIVE_MS = 15_000;
/**
 * 服务端下发的功能开关（原平台开关表里标为 serverOnly 的只认服务端）。docFonts：文档字体与版式设置；打开后宿主把版式发给
 * 编辑器，标题的折叠按钮才会出现。
 */
const SERVER_FLAGS = { docFonts: true };
const DATA_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

/**
 * 编辑器页面的 CSP：应用与编辑器 iframe 要执行脚本（含内联与 blob: Worker）、加载 Google Fonts（文档字体）、显示素材与
 * data:/blob: 图片；长连接是同源的 WebSocket。
 */
export function docsEditorCsp(frameAncestors?: string): string {
  const fonts = 'https://fonts.googleapis.com https://fonts.gstatic.com';
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    `connect-src 'self' ${fonts}`,
    "frame-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    ...(frameAncestors ? [`frame-ancestors ${frameAncestors}`] : []),
  ].join('; ');
}

class TooLarge extends Error {}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        request.removeAllListeners('data');
        request.resume();
        reject(new TooLarge());
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  response.end(body);
}

/** 写请求只接受同源（编辑器页面自己的 fetch）或不带 Origin 的请求：别的网页即使知道 grant 也写不进来。 */
function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const host = request.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function topicProject(topic: string): string {
  return topic.slice(topic.indexOf('project/') + 'project/'.length);
}

/** feed 信封里的 actor 照原版的写法：智能体经连接器写入是 `external` + `via: "mcp"`，编辑器据此认出是智能体。 */
function wireActor(actor: DocEventActor): { principal: string; channel: string; via?: string } {
  return actor.channel === 'agent' ? { principal: actor.principal, channel: 'external', via: AGENT_VIA } : { principal: actor.principal, channel: 'human' };
}

export class DocsServer implements DocsConnectorHost {
  readonly #options: DocsServerOptions;
  readonly #byGrant = new Map<string, OpenDoc>();
  readonly #byDir = new Map<string, OpenDoc>();
  /** 真实路径 → 内存里的那一份文档（载入中是 Promise）。 */
  readonly #docs = new Map<string, Promise<LiveDoc>>();
  readonly #doors = new WeakMap<LiveDoc, DocDoor>();
  readonly #unsubscribe = new WeakMap<LiveDoc, () => void>();
  #pageCache: { file: string; mtimeMs: number; html: string } | undefined;

  constructor(options: DocsServerOptions) {
    this.#options = options;
  }

  get #user(): DoorUser {
    const name = this.#options.userName?.()?.trim();
    return { principal: LOCAL_PRINCIPAL, name: name || 'Me' };
  }

  editorAvailable(): boolean {
    return this.#options.editorDist() !== null;
  }

  /** 为文档目录发 grant；同一个目录（真实路径）复用同一个。调用方先确认目录是文档。 */
  async open(dirPath: string): Promise<string> {
    const dir = await realpath(dirPath);
    const existing = this.#byDir.get(dir);
    if (existing) return existing.grant;
    this.#prune();
    const entry: OpenDoc = { grant: randomBytes(24).toString('base64url'), dir, mux: undefined };
    this.#byGrant.set(entry.grant, entry);
    this.#byDir.set(dir, entry);
    return entry.grant;
  }

  /** 文档目录在内存里的那一份（没载入过时从磁盘载入）。不是文档时抛错。 */
  doc(dirPath: string): Promise<LiveDoc> {
    return this.#load(dirPath);
  }

  async #load(dirPath: string): Promise<LiveDoc> {
    const dir = await realpath(dirPath).catch(() => path.resolve(dirPath));
    const cached = this.#docs.get(dir);
    if (cached) {
      const doc = await cached;
      if (!doc.gone) return doc;
      this.#docs.delete(dir);
    }
    const loading = (async () => {
      const state = await loadDocState(dir);
      if (!state) throw new Error('not a doc');
      const doc = new LiveDoc(dir, state, { onError: this.#options.onError, onGone: (gone) => this.#forget(gone), now: this.#options.now });
      await doc.scanAssets();
      this.#watch(doc);
      return doc;
    })();
    this.#docs.set(dir, loading);
    loading.catch(() => {
      if (this.#docs.get(dir) === loading) this.#docs.delete(dir);
    });
    return loading;
  }

  /** 还没写过盘的新文档（连接器新建时用）：成功后 `adopt` 进缓存。 */
  fresh(dir: string, state: DocState): LiveDoc {
    return new LiveDoc(dir, state, { fresh: true, onError: this.#options.onError, onGone: (gone) => this.#forget(gone), now: this.#options.now });
  }

  adopt(doc: LiveDoc): void {
    this.#docs.set(doc.dir, Promise.resolve(doc));
    this.#watch(doc);
  }

  door(doc: LiveDoc): DocDoor {
    let door = this.#doors.get(doc);
    if (!door) {
      door = new DocDoor(doc, () => this.#user);
      this.#doors.set(doc, door);
    }
    return door;
  }

  #forget(doc: LiveDoc): void {
    this.#unsubscribe.get(doc)?.();
    this.#unsubscribe.delete(doc);
    void this.#docs.get(doc.dir)?.then((current) => {
      if (current === doc) this.#docs.delete(doc.dir);
    });
    const entry = this.#byDir.get(doc.dir);
    entry?.mux?.close();
    if (entry) entry.mux = undefined;
  }

  /** 文档的变化推给这个目录的编辑器连接。 */
  #watch(doc: LiveDoc): void {
    if (this.#unsubscribe.has(doc)) return;
    this.#unsubscribe.set(
      doc,
      doc.subscribe((event) => this.#publish(doc, event)),
    );
  }

  #publish(doc: LiveDoc, event: DocEvent): void {
    const mux = this.#byDir.get(doc.dir)?.mux;
    if (!mux) return;
    const feed = `feed:project/${doc.id}`;
    const envelope = (diff: object[], extra: object = {}) =>
      JSON.stringify({ ev: 'envelope', data: { at: new Date().toISOString(), actor: wireActor(event.actor), diff, ...extra } });
    if (event.type === 'node') {
      // 告诉其他连接：正文有新修订，去读增量（发起编辑的连接自己已经有了）
      const diff = [{ address: { ref: { object: 'node', id: event.nodeId } } }];
      mux.broadcast(feed, envelope(diff, { edit: { rev: event.rev }, ...(event.opId ? { opId: event.opId } : {}) }), event.origin);
    } else if (event.type === 'comment') {
      // 地址是 utterance 时编辑器带着 comments 重读，拿到新锚点后画高亮；发起的连接也要收到（它只乐观地加了右栏卡片）
      const diff = [{ address: { ref: { object: 'utterance', id: event.threadId } }, after: { parent: { object: 'node', id: event.nodeId } } }];
      mux.broadcast(feed, envelope(diff));
    } else {
      // 编辑器的标签栏从 feed 收项目的改动：地址是 project，`after` 是改后的项目值（没有 `after` 编辑器当作文档被删了），
      // 按信封里的 actor 认出智能体加的标签页，提示「The agent added a tab」。room 照旧重发。
      const diff = [{ address: { ref: { object: 'project', id: doc.id } }, after: projectValue(doc.meta) }];
      mux.broadcast(feed, envelope(diff));
      for (const connection of mux.connections) this.#sendFold(doc, connection, `room:project/${doc.id}`);
    }
  }

  /** room 主题：先发索引，再发文档与各标签页、下拉选项、素材的值，最后 ready。编辑器的标签栏就来自这里。 */
  #sendFold(doc: LiveDoc, connection: MuxConnection, topic: string): void {
    if (!connection.topics.has(topic) || topicProject(topic) !== doc.id) return;
    const meta = doc.meta;
    const frame = (value: object) => connection.publish(topic, JSON.stringify({ v: 1, ...value }));
    const projectRef = `project/${meta.id}`;
    const parent = { object: 'project', id: meta.id };
    frame({
      kind: 'index',
      refs: [
        { ref: projectRef, engine: 'json' },
        ...meta.tabs.map((tab) => ({ ref: `file/${tab.id}`, engine: 'json', parent })),
        ...Object.keys(meta.enums).map((id) => ({ ref: `enum/${id}`, engine: 'json', parent })),
      ],
    });
    frame({ kind: 'sync', ref: projectRef, engine: 'json', value: projectValue(meta) });
    for (const tab of meta.tabs) frame({ kind: 'sync', ref: `file/${tab.id}`, engine: 'json', value: fileValue(tab) });
    for (const [id, value] of Object.entries(meta.enums)) frame({ kind: 'sync', ref: `enum/${id}`, engine: 'json', value });
    frame({ kind: 'ready' });
  }

  #mux(entry: OpenDoc): MuxServer {
    if (entry.mux) return entry.mux;
    const chatTimers = new Map<MuxConnection, ReturnType<typeof setInterval>>();
    const topics: TopicHandler[] = [
      {
        matches: (topic) => topic === 'chat',
        subscribe(connection) {
          connection.publish('chat', IDLE_CHAT_FRAME);
          clearInterval(chatTimers.get(connection));
          const timer = setInterval(() => connection.publish('chat', IDLE_CHAT_FRAME), CHAT_KEEPALIVE_MS);
          timer.unref?.();
          chatTimers.set(connection, timer);
        },
        unsubscribe(connection) {
          clearInterval(chatTimers.get(connection));
          chatTimers.delete(connection);
        },
      },
      {
        matches: (topic) => topic.startsWith('feed:project/'),
        subscribe: (connection, frame) => connection.ack(frame.topic),
      },
      {
        matches: (topic) => topic.startsWith('room:project/'),
        subscribe: (connection, frame) => {
          connection.ack(frame.topic);
          void this.#load(entry.dir).then(
            (doc) => this.#sendFold(doc, connection, frame.topic),
            (error: unknown) => this.#options.onError?.('Loading a doc failed', error),
          );
        },
      },
    ];
    entry.mux = new MuxServer({
      topics,
      onError: this.#options.onError,
      door: async (_address, body, kind, connection) => this.#doorCall(entry, body, kind, connection.canEdit, connection),
    });
    return entry.mux;
  }

  /** 编辑器的一次 door 调用（mux 的二进制帧，或 HTTP 的后备）。 */
  async #doorCall(entry: OpenDoc, body: string, kind: 'one' | 'batch', canEdit: boolean, origin?: unknown): Promise<{ status: number; body: unknown }> {
    let request: DoorRequest & { batch?: DoorRequest[]; members?: DoorRequest[] };
    try {
      request = JSON.parse(body) as typeof request;
    } catch {
      return { status: 400, body: { verdict: 'deny', reason: 'invalid_argument', detail: 'malformed request' } };
    }
    if (typeof request !== 'object' || request === null) return { status: 400, body: { verdict: 'deny', reason: 'invalid_argument', detail: 'malformed request' } };
    let doc: LiveDoc;
    try {
      doc = await this.#load(entry.dir);
    } catch {
      return { status: 200, body: { verdict: 'deny', reason: 'gone', detail: 'the doc is gone', data: { object: 'project' } } };
    }
    const door = this.door(doc);
    const ctx: DoorContext = { actor: humanActor(this.#user), canEdit, origin };
    if (kind === 'batch') {
      const members = request.batch ?? request.members ?? [];
      if (!Array.isArray(members)) return { status: 400, body: { verdict: 'deny', reason: 'invalid_argument', detail: 'batch must be an array' } };
      return { status: 200, body: door.handleBatch(members, ctx) };
    }
    return { status: 200, body: door.handle(request, ctx) };
  }

  /** 关掉所有连接，把文档写盘。 */
  async close(): Promise<void> {
    for (const entry of this.#byGrant.values()) entry.mux?.close();
    this.#byGrant.clear();
    this.#byDir.clear();
    const docs = await Promise.allSettled([...this.#docs.values()]);
    this.#docs.clear();
    await Promise.allSettled(docs.map((result) => (result.status === 'fulfilled' ? result.value.close() : undefined)));
  }

  /** `/docs/<grant>/api/mux` 的升级；不是 `/docs/` 返回 false。grant 不对时回 404 并关掉连接。 */
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer, options: DocsRouteOptions): boolean {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const match = /^\/docs\/([^/]+)\/api\/mux$/.exec(url.pathname);
    if (!url.pathname.startsWith('/docs/')) return false;
    const entry = match && GRANT_PATTERN.test(match[1]!) ? this.#byGrant.get(match[1]!) : undefined;
    if (!entry || !sameOrigin(request)) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return true;
    }
    this.#mux(entry).handleUpgrade(request, socket, head, options.canEdit);
    return true;
  }

  /** 处理 `/docs/…`；不是这个前缀返回 false。 */
  handle(request: IncomingMessage, response: ServerResponse, options: DocsRouteOptions): boolean {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const match = /^\/docs\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!match) return false;
    const entry = GRANT_PATTERN.test(match[1]!) ? this.#byGrant.get(match[1]!) : undefined;
    if (!entry) {
      response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
      return true;
    }
    if (match[2] === undefined) {
      // 编辑器用相对地址取样式与脚本：页面地址必须以 / 结尾
      response.writeHead(308, { Location: `/docs/${entry.grant}/${url.search}`, 'Cache-Control': 'no-store' }).end();
      return true;
    }
    let rest: string;
    try {
      rest = decodeURIComponent(match[2].slice(1));
    } catch {
      response.writeHead(400).end();
      return true;
    }
    void this.#guard(response, () => this.#route(entry, rest, url, request, response, options));
    return true;
  }

  async #guard(response: ServerResponse, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      if (error instanceof TooLarge) {
        if (!response.headersSent) sendJson(response, 413, { error: 'too_large' });
        return;
      }
      this.#options.onError?.('Docs request failed', error);
      if (!response.headersSent) sendJson(response, 500, { error: 'internal' });
      else response.destroy();
    }
  }

  async #route(entry: OpenDoc, rest: string, url: URL, request: IncomingMessage, response: ServerResponse, options: DocsRouteOptions): Promise<void> {
    if (rest === 'api/mux') {
      response.writeHead(426, { Upgrade: 'websocket', 'Cache-Control': 'no-store' }).end();
      return;
    }
    if (rest.startsWith('api/')) {
      await this.#api(entry, rest.slice('api/'.length), url, request, response, options);
      return;
    }
    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    if (rest === '' || rest === 'index.html' || rest === 'project' || rest.startsWith('project/')) {
      await this.#serveIndex(entry, request, response, options);
      return;
    }
    // 字体按相对地址引用，可能解析到别的层级（例如样式表所在的 assets/ 下）
    const font = /(?:^|\/)artifact-type\/fonts\/([^/]+)$/.exec(rest);
    await this.#serveStatic(font ? `artifact-type/fonts/${font[1]}` : rest, request, response);
  }

  async #api(entry: OpenDoc, route: string, url: URL, request: IncomingMessage, response: ServerResponse, options: DocsRouteOptions): Promise<void> {
    const method = request.method ?? 'GET';
    // 编辑器运行时在独立模式下走 /api/lfile-runtime/<hash>
    const runtime = /^lfile-runtime\/([A-Za-z0-9]+)$/.exec(route);
    if (runtime) {
      await this.#serveStatic(`artifact-type/lfile-runtime.${runtime[1]}.js`, request, response);
      return;
    }
    if (route === 'blob' && method === 'POST') {
      if (!sameOrigin(request) || !options.canEdit) {
        request.resume();
        sendJson(response, 403, { error: 'forbidden' });
        return;
      }
      await this.#uploadBlob(entry, request, response);
      return;
    }
    // door 的 HTTP 后备（编辑器平时走 mux）：POST v3/door/<地址>，batch 是 v3/door/<地址>/batch
    if (method === 'POST' && route.startsWith('v3/door/') && !/\/(feed|presence)$/.test(route)) {
      if (!sameOrigin(request)) {
        request.resume();
        sendJson(response, 403, { error: 'forbidden' });
        return;
      }
      const body = (await readBody(request, MAX_DOOR_BYTES)).toString('utf8');
      const reply = await this.#doorCall(entry, body, route.endsWith('/batch') ? 'batch' : 'one', options.canEdit);
      sendJson(response, reply.status, reply.body);
      return;
    }
    // 编辑器的版本面板（版本记录设计 §13.2）：版本列表、某一版的正文、回到这一版
    const version = /^v3\/project\/([^/]+)\/file\/([^/]+)\/(history|at\/(\d{1,9})|restore\/(\d{1,9}))$/.exec(route);
    if (version) {
      await this.#versionRoute(entry, version, url, request, response, options);
      return;
    }
    if (method === 'POST' || method === 'PUT') {
      // 埋点类接口：收下即可
      request.resume();
      if (route === 'activity' || route === 'events' || route.startsWith('telemetry') || route === 'prefs') {
        sendJson(response, 200, {});
        return;
      }
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    const blob = /^blob\/([^/]+)$/.exec(route);
    if (blob) {
      await this.#serveBlob(entry, blob[1]!, request, response);
      return;
    }
    const user = this.#user;
    switch (route) {
      case 'auth/claude/status':
        return sendJson(response, 200, { connected: true });
      case 'me':
        return sendJson(response, 200, { id: user.principal, email: user.principal, name: user.name, flags: { values: SERVER_FLAGS } });
      case 'prefs':
        return sendJson(response, 200, {});
      case 'health':
        return sendJson(response, 200, { ok: true });
      case 'v3/manifest':
        return sendJson(response, 200, url.searchParams.has('brief') ? { caps: SERVER_CAPS } : { door: { dialect: 'final' } });
      case 'v3/directory/org':
        return sendJson(response, 200, []);
      case 'activity':
      case 'events':
        return sendJson(response, 200, {});
    }
    if (route.startsWith('telemetry')) return sendJson(response, 200, {});
    if (route.startsWith('v3/versions/')) return sendJson(response, 200, { head: 0, defaultVersionId: null, lines: [] });
    const doc = await this.#load(entry.dir).catch(() => null);
    if (!doc) {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    const meta = doc.meta;
    if (route === 'baocut/annotation') return this.#annotation(doc, url, response);
    if (route === 'object') {
      const name = url.searchParams.get('name') ?? '';
      const id = name.startsWith('projects/') ? name.slice('projects/'.length) : name;
      if (id !== meta.id) return sendJson(response, 404, { error: 'not_found' });
      return sendJson(response, 200, {
        id: meta.id,
        name: `projects/${meta.id}`,
        displayName: meta.name,
        owner: user.principal,
        createdBy: user.principal,
        state: 'private',
        color: '',
        meta: '',
        updated: meta.updated,
        files: meta.tabs.map((tab) => tab.id),
        fileCount: meta.tabs.length,
        versions: [],
        dirty: 0,
      });
    }
    if (route === 'people/search') {
      // 找人：@提及 的候选、悬停名片按邮箱查名字。本机只有自己、智能体与文档里提到过的人
      const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const exact = url.searchParams.get('src') === 'primeExact';
      const people = new Map<string, { email: string; name: string }>([[user.principal, { email: user.principal, name: user.name }]]);
      for (const person of Object.values(meta.people)) if (!people.has(person.principal)) people.set(person.principal, { email: person.principal, name: person.name });
      const hits = [...people.values()].filter((person) =>
        exact ? person.email.toLowerCase() === query : !query || person.email.toLowerCase().includes(query) || person.name.toLowerCase().includes(query),
      );
      return sendJson(response, 200, { hits: hits.slice(0, 20), degraded: false });
    }
    // 引用其他文档（@ 文档）的候选：本机只有这一份
    if (route === 'v3/directory') return sendJson(response, 200, [{ id: meta.id, name: meta.name }]);
    if (route.startsWith('v3/files/')) {
      const id = route.slice('v3/files/'.length);
      if (id !== meta.id) return sendJson(response, 404, { files: [] });
      return sendJson(response, 200, { files: visibleTabs(meta).map((tab) => ({ id: tab.id, name: tab.name })) });
    }
    const project = /^v3\/project\/([^/]+)\/(access|routines|staged-runs|enums|databases)$/.exec(route);
    if (project) {
      if (project[1] !== meta.id) return sendJson(response, 404, { error: 'not_found' });
      if (project[2] === 'access') return sendJson(response, 200, { access: options.canEdit ? 'owner' : 'viewer' });
      if (project[2] === 'enums') return sendJson(response, 200, { rows: Object.entries(meta.enums).map(([id, value]) => ({ ...value, id })) });
      // 定时任务、待审批的运行、数据库：本机没有（单个数据库 `database/<id>` 落到下面的 404，编辑器当作不存在）
      return sendJson(response, 200, { rows: [] });
    }
    sendJson(response, 404, { error: 'not_found', path: route });
  }

  /**
   * 版本面板的三个接口（docs-runtime 的 api.v3FileHistory / v3FileAt / v3FileRestore，地址里是文档 id 与标签页 id）：
   * - `GET history`：每个版本一行（`historyRows`），新的在前；`?before=<版本号>` 只要更早的。
   * - `GET at/<版本号>`：那一版结束时的正文，写成编辑器读的 XML（`{xml}`，面板用编辑器自己的解析器读）。
   * - `POST restore/<版本号>`：正文换成那一版，单独记成一版（`{restored, rev}`）；和现在一样时不改（`restored: false`）。
   *   要能编辑、同源。挂在被换掉的字上的评论照常脱钩，不拦。
   */
  async #versionRoute(entry: OpenDoc, match: RegExpExecArray, url: URL, request: IncomingMessage, response: ServerResponse, options: DocsRouteOptions): Promise<void> {
    const method = request.method ?? 'GET';
    const restore = match[5] !== undefined;
    if (restore ? method !== 'POST' : method !== 'GET' && method !== 'HEAD') {
      request.resume();
      response.writeHead(405, { Allow: restore ? 'POST' : 'GET, HEAD' }).end();
      return;
    }
    if (restore) {
      request.resume();
      if (!sameOrigin(request) || !options.canEdit) return sendJson(response, 403, { error: 'forbidden' });
    }
    const doc = await this.#load(entry.dir).catch(() => null);
    const tab = doc?.meta.tabs.find((candidate) => candidate.id === match[2]);
    const node = tab?.nodeId ? doc!.node(tab.nodeId) : undefined;
    if (!doc || match[1] !== doc.meta.id || !tab || !node) return sendJson(response, 404, { error: 'not_found' });
    if (match[3] === 'history') {
      const before = Number(url.searchParams.get('before'));
      const rows = historyRows(node, doc.meta.id, tab.id);
      return sendJson(response, 200, Number.isInteger(before) && before > 0 ? rows.filter((row) => (row['params'] as { upto: number }).upto < before) : rows);
    }
    const version = versionNumbered(node, Number(match[4] ?? match[5]));
    if (!version) return sendJson(response, 404, { error: 'not_found' });
    if (!restore) return sendJson(response, 200, { xml: serializeDocument(versionBlocks(node, version), { rev: version.rev }) });
    const blocks = structuredClone(versionBlocks(node, version));
    if (sameBlocks(blocks, node.blocks)) return sendJson(response, 200, { restored: false, rev: node.rev });
    const door = this.door(doc);
    doc.transaction(() => door.restoreNode(node, blocks, version.rev, { actor: humanActor(this.#user), canEdit: true }));
    await doc.flush();
    sendJson(response, 200, { restored: true, rev: node.rev });
  }

  /**
   * 编辑器 shim 把批注发给智能体之前要的说明（editor/host.ts）：路径 `f-<标签页>#<正文>/<块>@<起>-<止>;thread=<线程>` 指的
   * 那条批注所在标签页的名字与挂着的原文。有原文的是评论（`comment`），挂在空处的是请求（`ask`）。
   */
  #annotation(doc: LiveDoc, url: URL, response: ServerResponse): void {
    const path = url.searchParams.get('path') ?? '';
    const match = /^f-([^#;/]+)#([^/;]+)(?:\/[^;]*)?;thread=([^;]+)$/.exec(path);
    const thread = match ? this.door(doc).threadOf(match[3]!) : undefined;
    if (!match || !thread) return sendJson(response, 404, { error: 'not_found' });
    const tab = doc.meta.tabs.find((candidate) => candidate.id === match[1] || candidate.nodeId === match[2]);
    const quote = this.door(doc).toWireComment(thread).at?.quote?.trim();
    const where = tab?.name ?? doc.meta.name;
    const short = quote && quote.length > 60 ? `${quote.slice(0, 59)}…` : quote;
    sendJson(response, 200, { kind: quote ? 'comment' : 'ask', label: short ? `${where} › "${short}"` : where, ...(quote ? { quote } : {}) });
  }

  async #uploadBlob(entry: OpenDoc, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const bytes = await readBody(request, MAX_BLOB_BYTES);
    if (bytes.length === 0) {
      sendJson(response, 400, { error: 'empty' });
      return;
    }
    const doc = await this.#load(entry.dir);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const header = (request.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    const mime = /^[\w.+-]+\/[\w.+-]+$/.test(header) ? header : 'application/octet-stream';
    await doc.putAsset(sha, mime, bytes);
    sendJson(response, 200, { sha });
  }

  /** `api/blob/<sha256>`，或 `api/blob/<素材 id>?container=…`：文档 assets/ 里的文件。 */
  async #serveBlob(entry: OpenDoc, id: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const doc = await this.#load(entry.dir).catch(() => null);
    const record = doc ? (doc.meta.blobs[id] ?? Object.values(doc.meta.blobs).find((blob) => blob.sha256 === id)) : undefined;
    const sha = record?.sha256 ?? (/^[0-9a-f]{64}$/.test(id) ? id : undefined);
    const file = doc && sha ? await doc.findAsset(sha) : null;
    const info = file ? await lstat(file).catch(() => null) : null;
    if (!file || !info?.isFile()) {
      response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    const type = record?.mime ?? STATIC_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': info.size,
      // 内容寻址：同一个地址的内容不会变
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': DATA_CSP,
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = createReadStream(file);
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  }

  async #serveIndex(entry: OpenDoc, request: IncomingMessage, response: ServerResponse, options: DocsRouteOptions): Promise<void> {
    const dist = this.#options.editorDist();
    if (dist === null) {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('Docs editor is not built');
      return;
    }
    const doc = await this.#load(entry.dir).catch(() => null);
    if (!doc) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('The doc is gone');
      return;
    }
    const file = path.join(dist, 'index.html');
    const info = await lstat(file).catch(() => null);
    if (!info?.isFile()) {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('Docs editor is not built');
      return;
    }
    if (this.#pageCache?.file !== file || this.#pageCache.mtimeMs !== info.mtimeMs) this.#pageCache = { file, mtimeMs: info.mtimeMs, html: await readFile(file, 'utf8') };
    const boot = JSON.stringify({ projectId: doc.id, canEdit: options.canEdit }).replace(/</g, '\\u003c');
    const injected = `<base href="/docs/${entry.grant}/" /><script>window.__BAOCUT_DOCS__=${boot}</script>`;
    const html = this.#pageCache.html.replace(/<head(\s[^>]*)?>/i, (head) => `${head}${injected}`);
    const body = Buffer.from(html);
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': docsEditorCsp(options.frameAncestors),
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  }

  async #serveStatic(rel: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const dist = this.#options.editorDist();
    const parts = rel.split('/');
    const invalid = parts.some((part) => part === '' || part === '.' || part === '..' || part.startsWith('.') || part.includes('\\'));
    if (dist === null || invalid) {
      response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    const realDist = await realpath(dist).catch(() => null);
    const file = realDist === null ? null : path.join(realDist, ...parts);
    let real = file === null ? null : await realpath(file).catch(() => null);
    // 编辑器运行时的文件名带哈希：地址里的哈希不对时用构建产物里唯一的那一个
    if (real === null && realDist !== null && /^artifact-type\/lfile-runtime\.[A-Za-z0-9]+\.js$/.test(rel)) {
      const names = await readdir(path.join(realDist, 'artifact-type')).catch(() => [] as string[]);
      const only = names.filter((name) => /^lfile-runtime\.[A-Za-z0-9]+\.js$/.test(name));
      if (only.length === 1) real = await realpath(path.join(realDist, 'artifact-type', only[0]!)).catch(() => null);
    }
    const info = real === null ? null : await lstat(real).catch(() => null);
    if (real === null || realDist === null || !real.startsWith(realDist + path.sep) || !info?.isFile()) {
      response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    const type = STATIC_TYPES[path.extname(real).toLowerCase()] ?? 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': info.size,
      // vite 产物与运行时的文件名带内容哈希
      'Cache-Control': parts[0] === 'assets' || parts[0] === 'artifact-type' ? 'private, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = createReadStream(real);
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  }

  #prune(): void {
    const max = this.#options.maxDocs ?? 64;
    while (this.#byGrant.size >= max) {
      const idle = [...this.#byGrant.values()].find((entry) => !entry.mux || entry.mux.connections.size === 0) ?? this.#byGrant.values().next().value;
      if (!idle) return;
      idle.mux?.close();
      this.#byGrant.delete(idle.grant);
      this.#byDir.delete(idle.dir);
    }
  }
}
