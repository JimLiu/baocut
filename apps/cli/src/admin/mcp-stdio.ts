import http from 'node:http';
import readline from 'node:readline';
import type { BaoCutClient } from '@baocut/client';
import { connectRuntime } from '../runtime/connection.ts';
import { MCP_TOKEN_ENV } from './agent-hosts.ts';
import { M } from './mcp-copy.ts';

/**
 * `baocut mcp serve --stdio`（CLI 独立使用与发布 §6.1）：宿主把它当作 stdio 形式的 MCP 服务器拉起。它按 CLI 的规则找到或拉起
 * Runtime（版本门与替换同其他命令），把 stdin 上一行一条的 JSON-RPC 原样 POST 给 Runtime 的 MCP 端点，令牌取自
 * `BAOCUT_MCP_TOKEN`，所以开放清单、访问等级与审计都与 HTTP 形式是同一个客户端；回答（JSON，或等审批时的 SSE）一条一行写回
 * stdout。stdout 只走协议，说明与错误写 stderr。
 *
 * - 转发期间开着一条 CLI 连接（已经取过目录，算在用），Runtime 不空闲退出，也不会被别的安装当作空闲替换掉。
 * - 连不上端点（请求还没送到）时重新找或拉起 Runtime，再送一次；送到之后 Runtime 退出的，那次请求以错误返回，不重放。
 * - 找不到、拉不起或版本不对时不退出：每个请求以错误返回原因，下一个请求再试，宿主里看得到为什么。
 */

export interface McpBridgeIo {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  errors: NodeJS.WritableStream;
}

/** 转发的目标：MCP 端点的地址，以及让 Runtime 保持在用的那条连接。 */
export interface McpTarget {
  url: string;
  /** 连接断了（Runtime 退出或被换掉）时调用一次。 */
  onLost(listener: () => void): void;
  close(): void;
}

export interface McpBridgeOptions extends McpBridgeIo {
  home: string;
  env: NodeJS.ProcessEnv;
  /** 找到或拉起 Runtime、开好 MCP 服务并返回地址；测试注入。 */
  connect?: () => Promise<McpTarget>;
}

/** 给宿主的 JSON-RPC 错误码：服务端错误段里的一个，表示 BaoCut 这边没能处理。 */
const BRIDGE_ERROR = -32000;

export async function serveMcpStdio(options: McpBridgeOptions): Promise<number> {
  const token = options.env[MCP_TOKEN_ENV]?.trim();
  if (!token) {
    options.errors.write(`${M.serveTokenMissing(MCP_TOKEN_ENV)}\n`);
    return 2;
  }
  const bridge = new McpBridge(token, options.connect ?? (() => connectMcpTarget(options.home, options.env)), options);
  return bridge.run();
}

/** 找到或拉起 Runtime，确认 MCP 服务开着（配置了随 Runtime 启动却没开时开它；用户关掉的不替他开），返回端点地址。 */
export async function connectMcpTarget(home: string, env: NodeJS.ProcessEnv): Promise<McpTarget> {
  const session = await connectRuntime({ home, start: true, env });
  const { client } = session;
  try {
    const url = await mcpUrl(client);
    return {
      url,
      onLost(listener) {
        let fired = false;
        client.onState((state) => {
          if (fired || state.status === 'connected' || state.status === 'connecting') return;
          fired = true;
          listener();
        });
      },
      close: () => client.close(),
    };
  } catch (error) {
    client.close();
    throw error;
  }
}

async function mcpUrl(client: BaoCutClient): Promise<string> {
  const { services } = await client.request('services.list', {});
  let service = services.find((candidate) => candidate.serviceId === 'mcp');
  if (!service?.available) throw new BridgeError(M.serviceNotAvailable);
  if (service.state !== 'on') {
    if (!service.autostart) throw new BridgeError(M.serveServiceOff);
    service = (await client.request('services.start', { serviceId: 'mcp' })).service;
    if (service.state !== 'on') throw new BridgeError(M.serviceStartFailed(service.error ?? null));
  }
  return (await client.request('services.mcp.connectionInfo', {})).url;
}

class BridgeError extends Error {}
/** 请求还没送到端点（连接被拒）：可以换一个 Runtime 再送。 */
class NotDelivered extends Error {}
/** 送到之后连接断了：不知道做没做，不重放。 */
class Lost extends Error {}

class McpBridge {
  readonly #token: string;
  readonly #connect: () => Promise<McpTarget>;
  readonly #io: McpBridgeIo;
  readonly #inflight = new Set<http.ClientRequest>();
  #target: Promise<McpTarget> | null = null;
  #closed = false;

  constructor(token: string, connect: () => Promise<McpTarget>, io: McpBridgeIo) {
    this.#token = token;
    this.#connect = connect;
    this.#io = io;
  }

  async run(): Promise<number> {
    // 先去找或拉起 Runtime：宿主的 `initialize` 到的时候多半已经连好。失败留给第一个请求报。
    this.#ensure().catch(() => undefined);
    const handling = new Set<Promise<void>>();
    const lines = readline.createInterface({ input: this.#io.input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const task = this.#handle(line).finally(() => handling.delete(task));
      handling.add(task);
    }
    // stdin 关了：把已经收下的请求答完再走（宿主等不及会发 SIGTERM，连接一断 Runtime 就取消它们等着的审批）。
    await Promise.all(handling);
    this.#close();
    return 0;
  }

  #ensure(): Promise<McpTarget> {
    if (!this.#target) {
      const pending = this.#connect().then((target) => {
        target.onLost(() => this.#drop(pending));
        if (this.#closed) target.close();
        return target;
      });
      pending.catch(() => this.#drop(pending));
      this.#target = pending;
    }
    return this.#target;
  }

  #drop(pending: Promise<McpTarget>): void {
    if (this.#target !== pending) return;
    this.#target = null;
    pending.then((target) => target.close(), () => undefined);
  }

  async #handle(line: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.#write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const id = requestId(message);
    try {
      await this.#forward(line);
    } catch (error) {
      if (this.#closed) return;
      const text = errorText(error);
      this.#log(text);
      if (id !== undefined) this.#write({ jsonrpc: '2.0', id, error: { code: BRIDGE_ERROR, message: text } });
    }
  }

  async #forward(body: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const pending = this.#ensure();
      const target = await pending;
      try {
        await this.#post(target.url, body);
        return;
      } catch (error) {
        if (error instanceof NotDelivered && attempt === 0) {
          // Runtime 不在了（退出或被换掉）：重新找或拉起一次，再送。
          this.#drop(pending);
          continue;
        }
        if (error instanceof NotDelivered || error instanceof Lost) {
          this.#drop(pending);
          throw new BridgeError(error instanceof Lost ? M.serveRuntimeLost : M.serveRuntimeUnavailable(error.message));
        }
        throw error;
      }
    }
  }

  /** 送一条消息，把回答（JSON 或 SSE 里的每个事件）写回 stdout；通知与回应的 202 没有输出。 */
  #post(url: string, body: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let responded = false;
      const request = http.request(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(body),
        },
      });
      this.#inflight.add(request);
      const settle = (error?: Error) => {
        this.#inflight.delete(request);
        if (error) reject(error);
        else resolve();
      };
      request.on('error', (error: NodeJS.ErrnoException) => {
        if (responded) return;
        settle(error.code === 'ECONNREFUSED' || error.code === 'ENOENT' ? new NotDelivered(error.message) : new Lost(error.message));
      });
      request.on('response', (response) => {
        responded = true;
        const status = response.statusCode ?? 0;
        if (status === 202 || status === 204) {
          response.resume();
          response.on('end', () => settle());
          return;
        }
        if (status !== 200) {
          response.resume();
          settle(new BridgeError(status === 401 ? M.serveTokenRejected : M.serveHttpStatus(status)));
          return;
        }
        const stream = /^\s*text\/event-stream/i.test(String(response.headers['content-type'] ?? ''));
        const events = stream ? new SseReader((data) => this.#writeText(data)) : null;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          if (events) events.push(chunk.toString('utf8'));
          else chunks.push(chunk);
        });
        response.on('aborted', () => settle(new Lost('aborted')));
        response.on('error', (error) => settle(new Lost(error.message)));
        response.on('end', () => {
          if (events) events.end();
          else this.#writeText(Buffer.concat(chunks).toString('utf8'));
          settle();
        });
      });
      request.end(body);
    });
  }

  /** 一条 JSON 文本写成一行（端点的回答本来就是一行；解析不了的照原样丢掉并记一笔）。 */
  #writeText(text: string): void {
    if (!text.trim()) return;
    try {
      this.#write(JSON.parse(text));
    } catch {
      this.#log(`Unreadable MCP response: ${text.slice(0, 200)}`);
    }
  }

  #write(payload: unknown): void {
    if (this.#closed) return;
    this.#io.output.write(`${JSON.stringify(payload)}\n`);
  }

  #log(text: string): void {
    this.#io.errors.write(`${text}\n`);
  }

  /** 收尾：断开还开着的请求，关掉让 Runtime 保持在用的连接。 */
  #close(): void {
    this.#closed = true;
    for (const request of this.#inflight) request.destroy();
    this.#inflight.clear();
    const pending = this.#target;
    this.#target = null;
    pending?.then((target) => target.close(), () => undefined);
  }
}

/** SSE 的事件：按空行分开，`data:` 行拼起来是一条消息；注释行（保活）与其他字段不管。 */
class SseReader {
  #buffer = '';
  readonly #emit: (data: string) => void;

  constructor(emit: (data: string) => void) {
    this.#emit = emit;
  }

  push(text: string): void {
    this.#buffer += text;
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.#buffer);
      if (!match) return;
      const event = this.#buffer.slice(0, match.index);
      this.#buffer = this.#buffer.slice(match.index + match[0].length);
      this.#event(event);
    }
  }

  end(): void {
    if (this.#buffer.trim()) this.#event(this.#buffer);
    this.#buffer = '';
  }

  #event(event: string): void {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''));
    if (data.length > 0) this.#emit(data.join('\n'));
  }
}

/** JSON-RPC 请求的 id；通知与回应没有（undefined）。 */
function requestId(message: unknown): string | number | null | undefined {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return undefined;
  const m = message as Record<string, unknown>;
  if (typeof m.method !== 'string' || !('id' in m)) return undefined;
  return typeof m.id === 'string' || typeof m.id === 'number' ? m.id : null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
