import crypto from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  RpcError,
  newId,
  type ClientKind,
  type RpcMethod,
  type RuntimeInfo,
  type ServerFrame,
  type Topic,
} from '@baocut/protocol';
import { RcGateway } from '@baocut/protocol/messages/runtime-core';
import { helloFrameSchema, methodParamSchemas, requestFrameSchema } from '@baocut/protocol/schemas';
import type { Logger } from '@baocut/harness';
import type { RpcHandlers } from './handlers.ts';

/**
 * 已认证连接的身份（架构设计 §4.2）。由 Runtime 构造，公共请求不能自己声明。`service` 只由对外服务（§4.8）为通过认证的外部请求构造，
 * `web` 只由 Web 服务为通过会话认证的浏览器连接构造（操作者是用户本人）；网关的 hello 不接受这两个种类：外部请求不能冒充界面连接。
 * `local` 只由 `catalog.call` 为 CLI 与桌面连接的目录调用构造（`LocalPrincipal`，§3.5），沿用发起调用的连接，写入算用户本人。
 */
export interface TrustedPrincipal {
  connectionId: string;
  kind: ClientKind | 'service' | 'web' | 'local';
  name: string;
  /** `web`：浏览器会话的 ID（吊销会话时按它断开连接）。 */
  sessionId?: string;
}

/** 升级时由外层认证给出的身份（Web 服务的会话 cookie）：有它时 hello 不再比对令牌。 */
export interface GatewayIdentity {
  kind: 'web';
  name: string;
  sessionId: string;
}

export interface GatewayOptions {
  token: string;
  runtime: RuntimeInfo;
  handlers: RpcHandlers;
  log: Logger;
  /** 额外允许的 Origin（开发服务器）。无 Origin、`null` 与 `file://` 总是允许。 */
  allowedOrigins?: readonly string[];
  /** 同一端口上的 HTTP 请求（媒体通道）。返回 false 表示不认识，回 404。 */
  http?: (request: IncomingMessage, response: ServerResponse) => boolean;
  /** 已认证的连接断开（释放它打开的视频之类）。 */
  onDisconnect?: (principal: TrustedPrincipal) => void;
  /** 握手成功（Web 服务按会话数连接）。 */
  onConnect?: (principal: TrustedPrincipal) => void;
  /** 握手之后的每个请求（含 `subscribe`），在分发之前（Runtime 据此判断连接是否在用）。 */
  onRequest?: (principal: TrustedPrincipal, method: RpcMethod) => void;
  /**
   * 方法与主题的白名单（Web 服务）：在分发之前同步检查，`subscribe` 也经过这里（按 `params.topic`）。
   * 返回错误表示拒绝，原样回给调用方。
   */
  authorize?: (method: RpcMethod, params: unknown, principal: TrustedPrincipal) => RpcError | null;
}

/** 网关的来源规则，媒体通道的 CORS 也用它。 */
export function originAllowed(origin: string | undefined, allowedOrigins: readonly string[] = []): boolean {
  if (origin === undefined || origin === 'null' || origin === 'file://') return true;
  return allowedOrigins.includes(origin);
}

const HELLO_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 30_000;
/** 发送缓冲超过这个量就断开，让客户端重连后按序号补发或取快照，而不是在内存里无限堆积。 */
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;
const MAX_FRAME_BYTES = 4 * 1024 * 1024;

/**
 * 本机网关（架构设计 §4）。只监听回环地址：同一个端口上，WebSocket 走协议，第一帧必须是带令牌的 hello；
 * 普通 HTTP 只服务媒体通道（§4.5）。
 */
export class Gateway {
  readonly #options: GatewayOptions;
  readonly #log: Logger;
  readonly #connections = new Set<Connection>();
  #server: WebSocketServer | null = null;
  #http: Server | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #closed = false;

  constructor(options: GatewayOptions) {
    this.#options = options;
    this.#log = options.log.child('gateway');
  }

  async listen(host = '127.0.0.1', port = 0): Promise<string> {
    const http = createServer((request, response) => {
      if (!this.#options.http?.(request, response)) response.writeHead(404).end();
    });
    // 先监听再挂 WebSocketServer：它会把 http 的 error 转发到自己身上，监听失败（端口被占）时没人接，
    // 进程收到未处理的 error，这里的 Promise 也永远不会落定。失败时原样抛出，不留下任何句柄。
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(port, host, () => {
        http.off('error', reject);
        resolve();
      });
    });
    this.#http = http;
    this.#start(new WebSocketServer({ server: http, maxPayload: MAX_FRAME_BYTES }));
    const address = http.address() as AddressInfo;
    const endpoint = `ws://${host}:${address.port}`;
    this.#log.info('Gateway listening', { endpoint });
    return endpoint;
  }

  /**
   * 别的 HTTP 服务器上的 WebSocket 升级（Web 服务）：来源与认证由调用方先查过，`identity` 是认证得到的身份。
   * 这个网关不自己监听。
   */
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer, identity: GatewayIdentity): void {
    if (this.#closed) {
      socket.destroy();
      return;
    }
    const server = this.#server ?? this.#start(new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES }));
    server.handleUpgrade(request, socket, head, (ws) => this.#accept(ws, request, identity));
  }

  /** 断开符合条件的已认证连接（吊销浏览器会话）。 */
  disconnectWhere(predicate: (principal: TrustedPrincipal) => boolean, reason: string): number {
    let count = 0;
    for (const connection of this.#connections) {
      const principal = connection.principal;
      if (principal && predicate(principal)) {
        connection.close(1008, reason);
        count++;
      }
    }
    return count;
  }

  #start(server: WebSocketServer): WebSocketServer {
    this.#server = server;
    server.on('error', (error) => this.#log.error('Gateway error', { error: String(error) }));
    server.on('connection', (socket, request) => this.#accept(socket, request));
    this.#heartbeat = setInterval(() => {
      for (const connection of this.#connections) connection.heartbeat();
    }, HEARTBEAT_MS);
    return server;
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    for (const connection of this.#connections) connection.close(1001, 'runtime stopping');
    const server = this.#server;
    this.#server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    const http = this.#http;
    this.#http = null;
    if (http) {
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  }

  #accept(socket: WebSocket, request: IncomingMessage, identity?: GatewayIdentity): void {
    const origin = request.headers.origin;
    // 外层认证过的升级（Web 服务）由外层按它自己的来源规则查过。
    if (!identity && !this.#originAllowed(origin)) {
      this.#log.warn('Refused origin', { origin });
      socket.close(1008, 'origin not allowed');
      return;
    }
    const connection = new Connection(socket, this.#options, this.#log, identity ?? null);
    this.#connections.add(connection);
    socket.once('close', () => {
      this.#connections.delete(connection);
      connection.dispose();
    });
  }

  #originAllowed(origin: string | undefined): boolean {
    return originAllowed(origin, this.#options.allowedOrigins);
  }
}

class Connection {
  readonly #socket: WebSocket;
  readonly #options: GatewayOptions;
  readonly #log: Logger;
  readonly #subscriptions = new Map<Topic, () => void>();
  readonly #helloTimer: ReturnType<typeof setTimeout>;
  readonly #identity: GatewayIdentity | null;
  #principal: TrustedPrincipal | null = null;
  #alive = true;

  constructor(socket: WebSocket, options: GatewayOptions, log: Logger, identity: GatewayIdentity | null) {
    this.#socket = socket;
    this.#options = options;
    this.#log = log;
    this.#identity = identity;
    this.#helloTimer = setTimeout(() => this.#fatal(new RpcError('unauthenticated', RcGateway.helloTimeout())), HELLO_TIMEOUT_MS);
    socket.on('pong', () => {
      this.#alive = true;
    });
    socket.on('message', (data, isBinary) => {
      if (isBinary) return this.#fatal(new RpcError('invalid-request', RcGateway.textFramesOnly()));
      this.#onMessage(data.toString());
    });
  }

  get principal(): TrustedPrincipal | null {
    return this.#principal;
  }

  heartbeat(): void {
    if (!this.#alive) {
      this.#socket.terminate();
      return;
    }
    this.#alive = false;
    this.#socket.ping();
  }

  close(code: number, reason: string): void {
    this.#socket.close(code, reason);
  }

  dispose(): void {
    clearTimeout(this.#helloTimer);
    for (const unsubscribe of this.#subscriptions.values()) unsubscribe();
    this.#subscriptions.clear();
    if (this.#principal) {
      this.#log.info('Connection closed', { connectionId: this.#principal.connectionId });
      this.#options.onDisconnect?.(this.#principal);
    }
  }

  #onMessage(text: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      return this.#fatal(new RpcError('invalid-request', RcGateway.frameNotJson()));
    }
    if (!this.#principal) return this.#hello(frame);

    const parsed = requestFrameSchema.safeParse(frame);
    if (!parsed.success) return this.#fatal(new RpcError('invalid-request', RcGateway.frameUnrecognized()));
    const { id, method, params } = parsed.data;
    if (!Object.hasOwn(methodParamSchemas, method)) {
      return this.#respondError(id, new RpcError('unknown-method', RcGateway.unknownMethod({ method })));
    }
    const schema = methodParamSchemas[method as RpcMethod];
    const checked = schema.safeParse(params ?? {});
    if (!checked.success) {
      return this.#respondError(id, new RpcError('invalid-request', RcGateway.invalidParams(), checked.error.issues));
    }
    this.#dispatch(id, method as RpcMethod, checked.data);
  }

  #hello(frame: unknown): void {
    const parsed = helloFrameSchema.safeParse(frame);
    if (!parsed.success) return this.#fatal(new RpcError('unauthenticated', RcGateway.helloRequired()));
    const hello = parsed.data;
    // 升级时已经认证过的连接（浏览器会话）不比对令牌：页面拿不到任何令牌，身份来自会话。
    if (!this.#identity && !tokenMatches(hello.token, this.#options.token)) {
      return this.#fatal(new RpcError('unauthenticated', RcGateway.invalidToken()));
    }
    if (hello.protocolVersion !== PROTOCOL_VERSION) {
      return this.#fatal(
        new RpcError('protocol-mismatch', RcGateway.protocolMismatch({ client: hello.protocolVersion, runtime: PROTOCOL_VERSION }), {
          runtime: PROTOCOL_VERSION,
        }),
      );
    }
    clearTimeout(this.#helloTimer);
    const identity = this.#identity;
    this.#principal = identity
      ? { connectionId: newId('conn'), kind: identity.kind, name: identity.name, sessionId: identity.sessionId }
      : { connectionId: newId('conn'), kind: hello.client.kind, name: hello.client.name };
    this.#log.info('Connection ready', { ...this.#principal, version: hello.client.version });
    this.#options.onConnect?.(this.#principal);
    this.#send({ type: 'welcome', runtime: this.#options.runtime, connectionId: this.#principal.connectionId });
  }

  #dispatch(id: string, method: RpcMethod, params: unknown): void {
    const denied = this.#options.authorize?.(method, params, this.#principal!);
    if (denied) return this.#respondError(id, denied);
    this.#options.onRequest?.(this.#principal!, method);
    // 订阅必须同步完成：登记监听、算出快照或补发、写回响应在同一段里，之后的事件才保证排在响应后面。
    if (method === 'subscribe') {
      try {
        const { topic, afterSeq } = params as { topic: Topic; afterSeq?: string };
        this.#subscriptions.get(topic)?.();
        const subscription = this.#options.handlers.subscribe(topic, afterSeq, (event) => {
          this.#send({ type: 'event', topic, seq: event.seq, event: event.event });
        });
        this.#subscriptions.set(topic, subscription.unsubscribe);
        this.#send({ type: 'response', id, ok: true, result: subscription.result });
      } catch (error) {
        this.#respondError(id, error);
      }
      return;
    }
    if (method === 'unsubscribe') {
      const { topic } = params as { topic: Topic };
      this.#subscriptions.get(topic)?.();
      this.#subscriptions.delete(topic);
      this.#send({ type: 'response', id, ok: true, result: { ok: true } });
      return;
    }

    const handler = this.#options.handlers.methods[method] as (params: unknown, principal: TrustedPrincipal) => unknown;
    Promise.resolve()
      .then(() => handler(params, this.#principal!))
      .then(
        (result) => this.#send({ type: 'response', id, ok: true, result }),
        (error) => this.#respondError(id, error),
      );
  }

  #respondError(id: string, error: unknown): void {
    const rpc = error instanceof RpcError ? error : new RpcError('internal', RcGateway.internalError());
    if (!(error instanceof RpcError)) this.#log.error('Request handling failed', { error: String(error) });
    this.#send({ type: 'response', id, ok: false, error: rpc.toPayload() });
  }

  #fatal(error: RpcError): void {
    this.#log.warn('Connection refused', { code: error.code, message: error.message });
    this.#send({ type: 'fatal', error: error.toPayload() });
    this.#socket.close(1008, error.code);
  }

  #send(frame: ServerFrame): void {
    if (this.#socket.readyState !== this.#socket.OPEN) return;
    if (this.#socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.#log.warn('Client reading too slowly; disconnecting', { connectionId: this.#principal?.connectionId });
      this.#socket.terminate();
      return;
    }
    this.#socket.send(JSON.stringify(frame));
  }
}

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
