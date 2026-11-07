import type { IncomingMessage, ServerResponse } from 'node:http';
import { RUNTIME_VERSION, type ConversationRole } from '@baocut/protocol';
import type { Logger } from '@baocut/harness';
import type { AgentGrants } from './grants.ts';
import type { ToolCatalog, ToolResult } from './tool-catalog.ts';
import type { ToolPrincipal } from './tool-scope.ts';

/**
 * MCP 端点（架构设计 §3.5、§4.8）：一个无状态的 MCP Streamable HTTP 端点，不发会话号、不开独立的 GET 流。
 * 回答默认是 `application/json`；一次调用过了 `MCP_KEEPALIVE_MS` 还没结果（在等用户批准或回答）、客户端又接受
 * `text/event-stream` 时，这次回答改成 SSE：每隔 `MCP_KEEPALIVE_MS` 发一次保活，结果作为最后一个事件（§3.12）。
 * 工具桥与对外的 MCP 服务共用它，区别只在认证得到的主体与工具目录：
 *
 * - 工具桥挂在本机网关上：原生智能体（Codex）按 `config.mcp_servers` 连上来，用会话令牌认证；
 * - MCP 服务有自己的回环监听：其他应用里的智能体用发放给客户端的令牌认证，另外只接受回环的 `Host`（防 DNS 重绑定）。
 *
 * - 只认 `/mcp`；带 `Origin` 的请求一律拒绝：浏览器里的网页不能调用它。
 * - 令牌只说明调用方是谁；能不能做由工具在每次调用时判断。
 */

export interface McpEndpointOptions {
  /** 工具桥：会话令牌。与 `authenticate` 二选一。 */
  grants?: AgentGrants;
  /** 请求 → 主体；令牌缺失、不认识或已吊销时为空（回 401）。 */
  authenticate?: (request: IncomingMessage) => ToolPrincipal | null;
  tools: ToolCatalog;
  log: Logger;
  /** 只接受 `Host` 为回环地址的请求。 */
  loopbackHostOnly?: boolean;
  /** `initialize` 回给客户端的服务信息；默认是 Runtime 的版本。 */
  serverInfo?: { version: string; meta?: Record<string, unknown> };
  /** 每次工具调用之后（审计）。 */
  onToolCall?: (name: string, principal: ToolPrincipal, result: ToolResult) => void;
  /** 会话主体的角色（Bot 技术方案 §10.1）：带 `roles` 的工具按它露出；不给时都按普通会话。 */
  roleOf?: (conversationId: string) => ConversationRole;
  /** 改用 SSE 保活前等多久、之后每隔多久保活一次；默认 `MCP_KEEPALIVE_MS`（测试用短的）。 */
  keepAliveMs?: number;
}

/**
 * 一次调用等了这么久还没结果，就改用 SSE 回答并按这个间隔保活。等批准、等回答的工具调用可能挂上几个小时，
 * 而一直不发数据的连接会被客户端当成断了：Claude Code 2.1.274 之前的 Bun fetch 约 4–5 分钟没有数据就以
 * 「The operation timed out.」放弃（单服务器的 `timeout` 管不到它），它的工具空闲看门狗没有回答或进度满 5 分钟也会放弃。
 * 请求带了 `progressToken` 时保活是 `notifications/progress`（两种都能重新计时），否则是 SSE 注释行。
 */
export const MCP_KEEPALIVE_MS = 25_000;

const PATH = '/mcp';
// Authenticated local submissions have no artificial body-size ceiling.
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

class JsonRpcFailure extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export class McpEndpoint {
  readonly #options: McpEndpointOptions;
  readonly #authenticate: (request: IncomingMessage) => ToolPrincipal | null;
  readonly #tools: ToolCatalog;
  readonly #log: Logger;

  constructor(options: McpEndpointOptions) {
    this.#options = options;
    const grants = options.grants;
    this.#authenticate = options.authenticate ?? ((request) => grants?.resolve(request.headers.authorization) ?? null);
    this.#tools = options.tools;
    this.#log = options.log.child('mcp');
  }

  /** 不是 `/mcp` 时返回 false，交给下一个处理者。认证通过时返回这次请求的主体。 */
  handle(request: IncomingMessage, response: ServerResponse): boolean {
    return this.accept(request, response) !== false;
  }

  /** 同 `handle`，但把认证得到的主体交给调用方（对外服务据此在请求结束时释放资源）：不是 `/mcp` 时 false，被拒绝时 null。 */
  accept(request: IncomingMessage, response: ServerResponse): ToolPrincipal | null | false {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== PATH) return false;
    if (this.#options.loopbackHostOnly && !loopbackHost(request.headers.host)) {
      response.writeHead(403).end();
      return null;
    }
    if (request.headers.origin !== undefined) {
      response.writeHead(403).end();
      return null;
    }
    const principal = this.#authenticate(request);
    if (!principal) {
      response.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end();
      return null;
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST' }).end();
      return principal;
    }
    void this.#post(request, response, principal).catch((error) => {
      this.#log.warn('MCP request failed', { error: String(error) });
      if (!response.headersSent) response.writeHead(500).end();
    });
    return principal;
  }

  async #post(request: IncomingMessage, response: ServerResponse, principal: ToolPrincipal): Promise<void> {
    const body = await readBody(request);
    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch {
      // i18n-ignore: 回给 MCP 客户端（智能体）的 JSON-RPC 错误
      reply(response, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失败' } });
      return;
    }
    if (Array.isArray(message)) {
      // i18n-ignore: 回给 MCP 客户端（智能体）的 JSON-RPC 错误
      reply(response, { jsonrpc: '2.0', id: null, error: { code: -32600, message: '不支持批量请求' } });
      return;
    }
    if (!isRequest(message)) {
      // 通知与对服务器请求的回应：收下即可。
      response.writeHead(202).end();
      return;
    }
    const settled = this.#settle(message, principal);
    if (!acceptsEventStream(request.headers.accept)) {
      reply(response, await settled);
      return;
    }
    const keepAlive = startKeepAlive(response, progressTokenOf(message), this.#options.keepAliveMs ?? MCP_KEEPALIVE_MS);
    const payload = await settled;
    keepAlive.stop();
    if (keepAlive.streaming) finishStream(response, payload);
    else reply(response, payload);
  }

  /** 一次请求的 JSON-RPC 回答：结果或错误，不抛出。 */
  async #settle(message: JsonRpcRequest, principal: ToolPrincipal): Promise<unknown> {
    try {
      const result = await this.#dispatch(message, principal);
      return { jsonrpc: '2.0', id: message.id, result };
    } catch (error) {
      // i18n-ignore: 回给 MCP 客户端（智能体）的 JSON-RPC 错误
      const failure = error instanceof JsonRpcFailure ? error : new JsonRpcFailure(-32603, '内部错误');
      if (!(error instanceof JsonRpcFailure)) this.#log.error('MCP method failed', { method: message.method, error: String(error) });
      return { jsonrpc: '2.0', id: message.id, error: { code: failure.code, message: failure.message } };
    }
  }

  async #dispatch(message: JsonRpcRequest, principal: ToolPrincipal): Promise<unknown> {
    const params = message.params ?? {};
    const tools = principal.kind === 'agent' && this.#options.roleOf ? this.#tools.forRole(this.#options.roleOf(principal.conversationId)) : this.#tools;
    switch (message.method) {
      case 'initialize': {
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        const info = this.#options.serverInfo;
        return {
          protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'baocut', title: 'BaoCut', version: info?.version ?? RUNTIME_VERSION },
          ...(info?.meta ? { _meta: info.meta } : {}),
        };
      }
      case 'ping':
        return {};
      case 'tools/list':
        // MCP 的工具形状：目录项的 `effect`、`examples`、`surfaces`、`positional` 给 CLI 与帮助用，不进 tools/list。
        return {
          tools: tools.list().map(({ name, title, description, inputSchema, annotations }) => ({
            name,
            title,
            description,
            inputSchema,
            ...(annotations ? { annotations } : {}),
          })),
        };
      case 'tools/call': {
        // i18n-ignore: 回给 MCP 客户端（智能体）的 JSON-RPC 错误
        if (typeof params.name !== 'string') throw new JsonRpcFailure(-32602, '缺少工具名');
        const result = await tools.call(params.name, params.arguments, principal);
        this.#options.onToolCall?.(params.name, principal, result);
        return result;
      }
      default:
        // i18n-ignore: 回给 MCP 客户端（智能体）的 JSON-RPC 错误
        throw new JsonRpcFailure(-32601, `不支持的方法：${message.method}`);
    }
  }
}

/** `Host` 是回环地址（可带端口）。没有 `Host` 的请求不接受。 */
export function loopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const match = /^(\[::1\]|127\.0\.0\.1|localhost)(:\d{1,5})?$/i.exec(host.trim());
  return match !== null;
}

function isRequest(message: unknown): message is JsonRpcRequest {
  if (typeof message !== 'object' || message === null) return false;
  const m = message as Record<string, unknown>;
  return typeof m.method === 'string' && (typeof m.id === 'string' || typeof m.id === 'number');
}

function reply(response: ServerResponse, payload: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  const text = JSON.stringify(payload);
  response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) }).end(text);
}

/** 客户端接受 SSE 回答（Streamable HTTP 要求客户端两种都列；只列 JSON 的照旧只回 JSON）。 */
function acceptsEventStream(accept: string | undefined): boolean {
  return (accept ?? '').split(',').some((part) => part.split(';')[0]!.trim().toLowerCase() === 'text/event-stream');
}

function progressTokenOf(message: JsonRpcRequest): string | number | undefined {
  const meta = message.params?._meta as { progressToken?: unknown } | undefined;
  const token = meta?.progressToken;
  return typeof token === 'string' || typeof token === 'number' ? token : undefined;
}

function sseEvent(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * 过了 `every` 还没结果：发 SSE 头，之后每隔 `every` 发一次保活（有 `progressToken` 时是递增的进度通知，否则是注释行）。
 * 连接断了就停；`streaming` 说明结果该走 SSE 还是 JSON。
 */
function startKeepAlive(response: ServerResponse, token: string | number | undefined, every: number): { readonly streaming: boolean; stop(): void } {
  let streaming = false;
  let progress = 0;
  const timer = setInterval(() => {
    if (response.destroyed || response.writableEnded) return;
    if (!streaming) {
      streaming = true;
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    }
    progress += 1;
    response.write(token === undefined ? ': keep-alive\n\n' : sseEvent({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress } }));
  }, every);
  const stop = () => clearInterval(timer);
  response.once('close', stop);
  return {
    get streaming() {
      return streaming;
    },
    stop,
  };
}

function finishStream(response: ServerResponse, payload: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.end(sseEvent(payload));
}

/** 本机已认证的提交不按固定大小截断。 */
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
