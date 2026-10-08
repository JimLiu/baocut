import type { IncomingMessage, ServerResponse } from 'node:http';
import { RUNTIME_VERSION } from '@baocut/protocol';
import type { Logger } from '@baocut/harness';
import type { AgentGrants } from './grants.ts';
import type { ToolCatalog, ToolResult } from './tool-catalog.ts';
import type { ToolPrincipal } from './tool-scope.ts';

/**
 * MCP 端点（架构设计 §3.5、§4.8）：一个无状态的 MCP Streamable HTTP 端点，只回 `application/json`，
 * 不开 SSE、不发会话号。工具桥与对外的 MCP 服务共用它，区别只在认证得到的主体与工具目录：
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
}

const PATH = '/mcp';
const MAX_BODY_BYTES = 1024 * 1024;
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
    if (body === null) {
      response.writeHead(413).end();
      return;
    }
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
    try {
      const result = await this.#dispatch(message, principal);
      reply(response, { jsonrpc: '2.0', id: message.id, result });
    } catch (error) {
      // i18n-ignore: 回给 MCP 客户端（智能体）的 JSON-RPC 错误
      const failure = error instanceof JsonRpcFailure ? error : new JsonRpcFailure(-32603, '内部错误');
      if (!(error instanceof JsonRpcFailure)) this.#log.error('MCP method failed', { method: message.method, error: String(error) });
      reply(response, { jsonrpc: '2.0', id: message.id, error: { code: failure.code, message: failure.message } });
    }
  }

  async #dispatch(message: JsonRpcRequest, principal: ToolPrincipal): Promise<unknown> {
    const params = message.params ?? {};
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
          tools: this.#tools.list().map(({ name, title, description, inputSchema, annotations }) => ({
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
        const result = await this.#tools.call(params.name, params.arguments, principal);
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
  const text = JSON.stringify(payload);
  response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) }).end(text);
}

/** 读完请求体；超过上限时返回 null。 */
async function readBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
