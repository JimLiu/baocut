/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/opencode/v2/runtime.ts 的 OpenCodeV2Runtime.start（`opencode serve
 * --hostname 127.0.0.1 --port 0`、随机的 OPENCODE_PASSWORD、等 stdout 的 `server listening on` 一行、Basic 认证、
 * 回 HTML 当作接口不兼容、stderr 读掉不留、先礼后兵地结束进程组）与 http-error.ts 的 OpenCodeHttpError。
 * 改成 BaoCut 用的一个会话一个 serve 进程（不做引用计数的进程池），HTTP 与事件流用手写的 fetch 客户端
 * （不依赖 @opencode/client），事件流断开与进程退出都交给会话处理。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { Logger } from '@baocut/harness';
import { DriversOpencode } from '@baocut/protocol/messages/agent-drivers';
import type { DriverText } from '../driver-text.ts';
import { OPENCODE_ENV } from './opencode-preset.ts';

/** 事件流里的一条：`{ id, type, data, durable? }`（v2 的 `V2Event`）。 */
export interface OpenCodeEvent {
  id?: string;
  type: string;
  data: Record<string, unknown>;
  durable?: { aggregateID: string; seq: number };
}

/** OpenCode 回了非 2xx，或者回的是网页（不是 v2 API）。 */
export class OpenCodeHttpError extends Error {
  readonly name = 'OpenCodeHttpError';
  readonly operation: string;
  readonly status: number;
  readonly tag: string | null;
  constructor(operation: string, status: number, tag: string | null, detail: DriverText | null) {
    super(String(DriversOpencode.httpFailed({ operation, status: String(status), tag: tag ?? '', detail: detail ?? '' })));
    this.operation = operation;
    this.status = status;
    this.tag = tag;
  }
}

export interface RequestOptions {
  /** 查询参数。`location` 编成 `location[directory]=…`，与 v2 API 的写法一致。 */
  query?: Record<string, string | undefined>;
  location?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** 单个请求的时限，默认 30 秒。 */
  timeoutMs?: number;
}

export interface ServeOptions {
  command: string;
  env: NodeJS.ProcessEnv;
  /** 子进程的工作目录。API 按请求里的 `location` 定项目目录，这里只影响 serve 自己。 */
  cwd: string;
  log: Logger;
  /** 等 `server listening on` 一行与 `/api/info` 的时限，默认 30 秒。 */
  startupTimeoutMs?: number;
}

const LISTENING = /server listening on (http:\/\/127\.0\.0\.1:\d+)\r?\n/;

/**
 * 一个 `opencode serve` 子进程与它的 HTTP 客户端。只监听 127.0.0.1，每次启动随机生成密码，别的进程连不上。
 */
export class OpenCodeServer {
  readonly url: string;
  /** 退出的原因：BaoCut 写的（信号、退出码）是 `Localized`，进程启动出错是原话；正常退出为 null。 */
  readonly exited: Promise<DriverText | null>;
  readonly #proc: ChildProcess;
  readonly #auth: string;
  readonly #log: Logger;
  readonly #abort = new AbortController();
  #exitedFlag = false;
  #stopping: Promise<void> | null = null;

  private constructor(proc: ChildProcess, url: string, auth: string, exited: Promise<DriverText | null>, log: Logger) {
    this.#proc = proc;
    this.url = url;
    this.#auth = auth;
    this.exited = exited;
    this.#log = log;
    void exited.then(() => {
      this.#exitedFlag = true;
      this.#abort.abort(new Error(String(DriversOpencode.processExited())));
    });
  }

  get hasExited(): boolean {
    return this.#exitedFlag;
  }

  static async start(options: ServeOptions): Promise<OpenCodeServer> {
    const password = randomBytes(32).toString('base64url');
    const timeoutMs = options.startupTimeoutMs ?? 30_000;
    const proc = spawn(options.command, ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
      cwd: options.cwd,
      env: { ...options.env, ...OPENCODE_ENV, OPENCODE_PASSWORD: password },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let exitedFlag = false;
    const exited = new Promise<DriverText | null>((resolve) => {
      proc.once('exit', (code, signal) => {
        exitedFlag = true;
        resolve(
          signal ? DriversOpencode.killedBySignal({ signal }) : code === 0 ? null : DriversOpencode.exitCode({ code: String(code) }),
        );
      });
      proc.once('error', (error) => {
        exitedFlag = true;
        resolve(error.message);
      });
    });
    // 输出里可能有凭据：读掉不留，只在调试日志里记长度。
    proc.stderr?.on('data', (chunk: Buffer) => options.log.debug('opencode serve stderr', { bytes: chunk.length }));
    const deadline = Date.now() + timeoutMs;
    let url: string;
    try {
      url = await new Promise<string>((resolve, reject) => {
        let buffer = '';
        const timer = setTimeout(() => finish(new Error(String(DriversOpencode.serveNotReady({ seconds: String(Math.round(timeoutMs / 1000)) })))), timeoutMs);
        const finish = (result: string | Error) => {
          clearTimeout(timer);
          proc.stdout?.off('data', onData);
          if (result instanceof Error) reject(result);
          else resolve(result);
        };
        const onData = (chunk: Buffer) => {
          buffer = (buffer + chunk.toString()).slice(-8192);
          const match = LISTENING.exec(buffer);
          if (match) finish(match[1]!);
        };
        proc.stdout?.on('data', onData);
        void exited.then((reason) =>
          finish(new Error(String(DriversOpencode.serveExitedAtStart({ reason: reason ?? DriversOpencode.exitCode({ code: '0' }) })))),
        );
      });
      // 之后的 stdout 也读掉，免得管道写满卡住子进程。
      proc.stdout?.on('data', () => undefined);
    } catch (error) {
      await stopProcess(proc, () => exitedFlag, exited);
      throw error;
    }
    const auth = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
    const server = new OpenCodeServer(proc, url, auth, exited, options.log);
    try {
      await server.request('GET', '/api/info', { timeoutMs: Math.max(1, deadline - Date.now()) });
    } catch (error) {
      await server.close();
      throw error;
    }
    return server;
  }

  async request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const signals = [this.#abort.signal, AbortSignal.timeout(options.timeoutMs ?? 30_000)];
    if (options.signal) signals.push(options.signal);
    const response = await fetch(this.#url(path, options), {
      method,
      headers: { authorization: this.#auth, ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.any(signals),
    });
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || type.includes('text/html')) {
      const text = await response.text().catch(() => '');
      let tag: string | null = null;
      let detail: DriverText | null = null;
      try {
        const body = JSON.parse(text) as { _tag?: unknown; message?: unknown };
        tag = typeof body._tag === 'string' ? body._tag : null;
        detail = typeof body.message === 'string' ? body.message : null;
      } catch {
        detail = type.includes('text/html') ? DriversOpencode.htmlResponse() : null;
      }
      throw new OpenCodeHttpError(`${method} ${path}`, response.status, tag, detail);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * 订阅全局事件流（`GET /api/event`，SSE）。每条 `data:` 是一个 JSON 事件；`:` 开头的心跳行忽略。
   * 流结束或出错时调 `onClose`（带原因；`stop()` 主动结束时原因为 null）。
   */
  subscribe(onEvent: (event: OpenCodeEvent) => void, onClose: (error: DriverText | null) => void): () => void {
    const controller = new AbortController();
    let stopped = false;
    const signal = AbortSignal.any([controller.signal, this.#abort.signal]);
    void (async () => {
      try {
        const response = await fetch(this.#url('/api/event', {}), {
          headers: { authorization: this.#auth, accept: 'text/event-stream' },
          signal,
        });
        if (!response.ok || !response.body) throw new Error(String(DriversOpencode.streamConnectFailed({ status: String(response.status) })));
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(chunk, { stream: true });
          let gap: RegExpExecArray | null;
          while ((gap = /\r?\n\r?\n/.exec(buffer))) {
            const frame = buffer.slice(0, gap.index);
            buffer = buffer.slice(gap.index + gap[0].length);
            const event = parseFrame(frame);
            if (event) onEvent(event);
          }
        }
        if (!stopped) onClose(DriversOpencode.streamEnded());
      } catch (error) {
        if (!stopped) onClose(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
    };
  }

  /** 结束 serve：先 SIGTERM 整个进程组，5 秒不退再 SIGKILL。 */
  close(): Promise<void> {
    this.#stopping ??= stopProcess(this.#proc, () => this.#exitedFlag, this.exited);
    return this.#stopping;
  }

  #url(path: string, options: RequestOptions): string {
    const url = new URL(path, this.url);
    if (options.location) url.searchParams.set('location[directory]', options.location);
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) url.searchParams.set(key, value);
    return url.toString();
  }
}

/** 一帧 SSE：把 `data:` 行拼起来解析成事件；心跳与解析不了的返回 null。 */
export function parseFrame(frame: string): OpenCodeEvent | null {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(line.startsWith('data: ') ? 6 : 5))
    .join('\n');
  if (!data) return null;
  try {
    const event = JSON.parse(data) as OpenCodeEvent;
    if (typeof event?.type !== 'string') return null;
    event.data ??= {};
    return event;
  } catch {
    return null;
  }
}

async function stopProcess(proc: ChildProcess, hasExited: () => boolean, exited: Promise<unknown>): Promise<void> {
  if (hasExited()) return;
  const kill = (signal: NodeJS.Signals) => {
    try {
      // detached 启动的子进程自成一个进程组：连它派生的命令一起结束。
      if (process.platform !== 'win32' && proc.pid) process.kill(-proc.pid, signal);
      else proc.kill(signal);
    } catch {
      proc.kill(signal);
    }
  };
  kill('SIGTERM');
  const timer = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5_000).unref());
  if ((await Promise.race([exited.then(() => 'exited' as const), timer])) === 'timeout') {
    kill('SIGKILL');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1_000).unref())]);
  }
}
