import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import { refOf, type Localized, type MessageRef } from '@baocut/protocol';
import { ProcessHostWorker as W } from '@baocut/protocol/messages/process-host';

/**
 * 私有执行器通道（架构设计 §13.1 `process-host`）：stdio 上的 JSON 行子进程客户端。
 *
 * 协议与 Engine Host、Model Worker 相同：请求 `{id, method, params}`，响应 `{id, result}` / `{id, error}`，
 * 推送 `{event, params}`。这里不认识任何方法或事件的名字，只负责：
 *
 * - 递增的数字 `id` 与在途请求表；子进程退出时所有在途请求以 `WorkerExitedError` 拒绝；
 * - 可选的请求超时（不给就不超时：一次推理可以跑好几分钟）；
 * - stderr 只记最后一段（默认 64 KiB），供崩溃诊断取尾部；
 * - `close()` 关 stdin 让子进程自己退出，超过宽限期 SIGKILL；`kill()` 立即结束。
 *
 * 由 `close()` / `kill()` 引起的退出标为 `expected`，调用方据此区分正常停止与崩溃。
 */

export interface WorkerCommand {
  command: string;
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface JsonLineWorkerOptions extends WorkerCommand {
  /** stderr 尾部保留的字节数（默认 64 KiB）。 */
  stderrLimitBytes?: number;
  /** 每一行 stderr（日志转发用）。 */
  onStderrLine?: (line: string) => void;
}

export interface WorkerEvent {
  event: string;
  params: unknown;
}

export interface WorkerExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** 退出由 `close()` / `kill()` 引起。 */
  expected: boolean;
}

/** 子进程返回的错误体。形状不对时 `code` 为 `MALFORMED_ERROR`。 */
export interface WorkerErrorBody {
  code: string;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

/** 请求得到了错误响应。 */
export class WorkerRequestError extends Error {
  readonly method: string;
  readonly body: WorkerErrorBody;
  /** 说明的消息引用，供按读者语言重新显示。 */
  readonly messageRef: MessageRef;

  constructor(method: string, body: WorkerErrorBody) {
    const message = W.requestFailed({ method, code: body.code, message: body.message });
    super(message.text);
    this.messageRef = refOf(message);
    this.name = 'WorkerRequestError';
    this.method = method;
    this.body = body;
  }

  get code(): string {
    return this.body.code;
  }
}

/** 请求在途时子进程退出了（或者请求发出时它已经不在）。 */
export class WorkerExitedError extends Error {
  readonly method: string;
  readonly exit: WorkerExit | null;
  /** 说明的消息引用，供按读者语言重新显示。 */
  readonly messageRef: MessageRef;

  constructor(method: string, exit: WorkerExit | null) {
    const message: Localized = exit
      ? W.exited({ method, code: String(exit.code), signal: String(exit.signal) })
      : W.notRunning({ method });
    super(message.text);
    this.messageRef = refOf(message);
    this.name = 'WorkerExitedError';
    this.method = method;
    this.exit = exit;
  }
}

export class WorkerTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;
  /** 说明的消息引用，供按读者语言重新显示。 */
  readonly messageRef: MessageRef;

  constructor(method: string, timeoutMs: number) {
    const message = W.timedOut({ method, ms: timeoutMs });
    super(message.text);
    this.messageRef = refOf(message);
    this.name = 'WorkerTimeoutError';
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

export class WorkerSpawnError extends Error {
  /** 说明的消息引用，供按读者语言重新显示。 */
  readonly messageRef: MessageRef;

  constructor(command: string, cause: Error) {
    const message = W.spawnFailed({ command, error: cause.message });
    super(message.text, { cause });
    this.messageRef = refOf(message);
    this.name = 'WorkerSpawnError';
  }
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_STDERR_LIMIT = 64 * 1024;
const DEFAULT_GRACE_MS = 5_000;

export class JsonLineWorker {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<number, Pending>();
  readonly #eventListeners = new Set<(event: WorkerEvent) => void>();
  readonly #exitListeners = new Set<(exit: WorkerExit) => void>();
  readonly #stderrLimit: number;
  readonly #stderr: Buffer[] = [];
  readonly #exited: Promise<WorkerExit>;
  #stderrBytes = 0;
  #nextId = 1;
  #expected = false;
  #exit: WorkerExit | null = null;

  private constructor(child: ChildProcessWithoutNullStreams, options: JsonLineWorkerOptions) {
    this.#child = child;
    this.#stderrLimit = options.stderrLimitBytes ?? DEFAULT_STDERR_LIMIT;
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => this.#onLine(line));
    child.stderr.on('data', (chunk: Buffer) => this.#onStderr(chunk));
    if (options.onStderrLine) {
      const onLine = options.onStderrLine;
      readline.createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', (line) => onLine(line));
    }
    child.stdin.on('error', () => {});
    // `close` 而不是 `exit`：stdio 读完之后才算退出，子进程退出前写出的最后几行响应不会丢。
    this.#exited = new Promise((resolve) => {
      child.once('close', (code, signal) => {
        const exit: WorkerExit = { code, signal, expected: this.#expected };
        this.#exit = exit;
        for (const pending of this.#pending.values()) {
          if (pending.timer) clearTimeout(pending.timer);
          pending.reject(new WorkerExitedError(pending.method, exit));
        }
        this.#pending.clear();
        for (const listener of this.#exitListeners) listener(exit);
        resolve(exit);
      });
    });
  }

  /** 启动子进程；进程起来（`spawn` 事件）就返回，不发任何请求。 */
  static start(options: JsonLineWorkerOptions): Promise<JsonLineWorker> {
    return new Promise((resolve, reject) => {
      const child = spawn(options.command, [...(options.args ?? [])], {
        env: options.env ?? process.env,
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.once('error', (error) => reject(new WorkerSpawnError(options.command, error)));
      child.once('spawn', () => resolve(new JsonLineWorker(child, options)));
    });
  }

  get pid(): number | null {
    return this.#child.pid ?? null;
  }

  get alive(): boolean {
    return this.#exit === null;
  }

  /** 进程退出时兑现；已经退出时立即兑现。 */
  get exited(): Promise<WorkerExit> {
    return this.#exited;
  }

  request<T>(method: string, params: unknown, options: { timeoutMs?: number } = {}): Promise<T> {
    if (this.#exit) return Promise.reject(new WorkerExitedError(method, this.#exit));
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      const pending: Pending = { method, resolve: resolve as (value: unknown) => void, reject, timer: null };
      if (options.timeoutMs !== undefined) {
        const timeoutMs = options.timeoutMs;
        pending.timer = setTimeout(() => {
          this.#pending.delete(id);
          reject(new WorkerTimeoutError(method, timeoutMs));
        }, timeoutMs);
      }
      this.#pending.set(id, pending);
      this.#child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  onEvent(listener: (event: WorkerEvent) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  onExit(listener: (exit: WorkerExit) => void): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  /** 关 stdin，让子进程处理完已收到的请求后自己退出；超过宽限期 SIGKILL。 */
  async close(graceMs = DEFAULT_GRACE_MS): Promise<WorkerExit> {
    if (this.#exit) return this.#exit;
    this.#expected = true;
    this.#child.stdin.end();
    const timer = setTimeout(() => this.#child.kill('SIGKILL'), graceMs);
    const exit = await this.#exited;
    clearTimeout(timer);
    return exit;
  }

  /** 立即结束子进程。 */
  async kill(signal: NodeJS.Signals = 'SIGKILL'): Promise<WorkerExit> {
    if (this.#exit) return this.#exit;
    this.#expected = true;
    this.#child.kill(signal);
    return this.#exited;
  }

  /** stderr 的最后一段（最多 `stderrLimitBytes` 字节），按 UTF-8 解码。 */
  stderrTail(): string {
    return Buffer.concat(this.#stderr).toString('utf8');
  }

  #onStderr(chunk: Buffer): void {
    this.#stderr.push(chunk);
    this.#stderrBytes += chunk.length;
    while (this.#stderrBytes > this.#stderrLimit && this.#stderr.length > 0) {
      const head = this.#stderr[0]!;
      const excess = this.#stderrBytes - this.#stderrLimit;
      if (head.length <= excess) {
        this.#stderr.shift();
        this.#stderrBytes -= head.length;
      } else {
        this.#stderr[0] = head.subarray(excess);
        this.#stderrBytes -= excess;
      }
    }
  }

  #onLine(line: string): void {
    let message: { id?: unknown; result?: unknown; error?: unknown; event?: unknown; params?: unknown };
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    if (typeof message.event === 'string') {
      const event: WorkerEvent = { event: message.event, params: message.params ?? {} };
      for (const listener of this.#eventListeners) {
        try {
          listener(event);
        } catch {
          // 监听者自己的异常不影响通道。
        }
      }
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    if (pending.timer) clearTimeout(pending.timer);
    if (message.error !== undefined) pending.reject(new WorkerRequestError(pending.method, errorBody(message.error)));
    else pending.resolve(message.result);
  }
}

function errorBody(raw: unknown): WorkerErrorBody {
  if (typeof raw === 'object' && raw !== null) {
    const body = raw as Record<string, unknown>;
    if (typeof body.code === 'string' && typeof body.message === 'string') {
      return {
        code: body.code,
        message: body.message,
        ...(typeof body.retryable === 'boolean' ? { retryable: body.retryable } : {}),
        ...(body.details !== undefined ? { details: body.details } : {}),
      };
    }
  }
  return { code: 'MALFORMED_ERROR', message: W.malformedError().text, details: raw };
}
