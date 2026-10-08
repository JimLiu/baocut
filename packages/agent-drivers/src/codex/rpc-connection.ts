import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import type { Logger } from '@baocut/harness';
import { DriversCodex, DriversCommon } from '@baocut/protocol/messages/agent-drivers';
import { LocalizedError } from '../driver-text.ts';

/**
 * `codex app-server` 的 stdio 传输：每行一个 JSON 对象，JSON-RPC 形状但不带 `"jsonrpc"` 字段。
 * 三种入站消息：对我方请求的响应（有 id、有 result/error）、服务端请求（有 id 与 method）、
 * 通知（有 method、无 id）。服务端请求的 id 可能是字符串或数字，原样回写。
 */

export type RpcId = string | number;

export class CodexRpcError extends Error {
  readonly code: number | string | undefined;
  readonly data: unknown;

  constructor(message: string, code: number | string | undefined, data: unknown) {
    super(message);
    this.name = 'CodexRpcError';
    this.code = code;
    this.data = data;
  }
}

/** 请求处理器抛出它表示「不回写响应」：服务端已经自行结算了这个请求。 */
export const NO_RESPONSE = Symbol('no-response');

export type ServerRequestHandler = (params: unknown, id: RpcId) => Promise<unknown> | unknown;
export type NotificationHandler = (method: string, params: unknown) => void;

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const STDERR_LIMIT = 8192;

export class CodexRpcConnection {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #log: Logger;
  readonly #pending = new Map<number, Pending>();
  readonly #handlers = new Map<string, ServerRequestHandler>();
  #onNotification: NotificationHandler = () => {};
  #onExit: (error: Error | null) => void = () => {};
  #nextId = 1;
  #closed = false;
  #stderr = '';

  constructor(child: ChildProcessWithoutNullStreams, log: Logger) {
    this.#child = child;
    this.#log = log;
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => this.#handleLine(line));
    child.stderr.on('data', (chunk: Buffer) => {
      this.#stderr = (this.#stderr + chunk.toString()).slice(-STDERR_LIMIT);
    });
    child.on('error', (error) => this.#terminate(error));
    child.on('exit', (code, signal) => {
      const clean = this.#closed || (code === 0 && !signal);
      this.#terminate(
        clean
          ? null
          : new LocalizedError(
              DriversCodex.appServerExited({ code: String(code ?? 'null'), signal: String(signal ?? 'null'), stderr: this.#stderr.trim() }),
            ),
      );
    });
  }

  get stderrTail(): string {
    return this.#stderr;
  }

  onNotification(handler: NotificationHandler): void {
    this.#onNotification = handler;
  }

  onExit(handler: (error: Error | null) => void): void {
    this.#onExit = handler;
  }

  handle(method: string, handler: ServerRequestHandler): void {
    this.#handlers.set(method, handler);
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs: number | null = 60_000): Promise<T> {
    if (this.#closed) return Promise.reject(new Error(String(DriversCodex.connectionClosed())));
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              this.#pending.delete(id);
              reject(new Error(String(DriversCodex.requestTimeout({ method }))));
            }, timeoutMs);
      this.#pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject, timer });
      this.#write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    if (!this.#closed) this.#write(params === undefined ? { method } : { method, params });
  }

  /** 关闭 stdin 请它退出；超时后 SIGTERM，再超时 SIGKILL。 */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#rejectAll(new Error(String(DriversCodex.connectionClosed())));
    const child = this.#child;
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.stdin.end();
    const wait = (ms: number) =>
      Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
    if (await wait(1500)) return;
    child.kill('SIGTERM');
    if (await wait(1500)) return;
    child.kill('SIGKILL');
    await wait(1000);
  }

  #write(message: unknown): void {
    if (!this.#child.stdin.writable) return;
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line: string): void {
    if (!line.trim()) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.#log.warn('Ignoring non-JSON output from codex app-server');
      return;
    }
    const hasId = typeof msg.id === 'number' || typeof msg.id === 'string';
    const method = typeof msg.method === 'string' ? msg.method : null;

    if (hasId && method) {
      void this.#answer(msg.id as RpcId, method, msg.params);
      return;
    }
    if (hasId) {
      const pending = this.#pending.get(msg.id as number);
      if (!pending) return;
      this.#pending.delete(msg.id as number);
      if (pending.timer) clearTimeout(pending.timer);
      const error = msg.error as { message?: string; code?: number | string; data?: unknown } | undefined;
      if (error) pending.reject(new CodexRpcError(error.message ?? String(DriversCommon.unknownError()), error.code, error.data));
      else pending.resolve(msg.result);
      return;
    }
    if (method) {
      try {
        this.#onNotification(method, msg.params);
      } catch (error) {
        this.#log.error('Handling a codex notification failed', { method, error: String(error) });
      }
    }
  }

  async #answer(id: RpcId, method: string, params: unknown): Promise<void> {
    const handler = this.#handlers.get(method);
    if (!handler) {
      this.#log.warn('codex sent an unsupported server request', { method });
      // i18n-ignore: 回给 codex app-server 的协议错误，不给人看
      this.#write({ id, error: { code: -32601, message: `BaoCut 不支持 ${method}` } });
      return;
    }
    try {
      const result = await handler(params, id);
      this.#write({ id, result });
    } catch (error) {
      if (error === NO_RESPONSE) return;
      this.#write({ id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
    }
  }

  #terminate(error: Error | null): void {
    const wasClosed = this.#closed;
    this.#closed = true;
    this.#rejectAll(error ?? new Error(String(DriversCodex.appServerGone())));
    if (!wasClosed || error) this.#onExit(error);
    this.#onExit = () => {};
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
