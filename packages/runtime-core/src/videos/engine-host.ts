import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { RpcError, isEngineErrorBody, localizeText, type EngineErrorBody, type VideoEvent, type RpcErrorCode } from '@baocut/protocol';
import type { Logger } from '@baocut/harness';
import { findBundledBinary } from '@baocut/process-host';
import { RcVideo } from '@baocut/protocol/messages/runtime-core';

/**
 * Engine Host 子进程的客户端（架构设计 §2.3）。
 *
 * 协议是 stdin/stdout 上的 JSON 行：请求 `{id, method, params}`，响应 `{id, result}` / `{id, error}`，
 * 推送 `{event: "video.event", params}`。引擎总是先写事件、再写触发它的响应，这里按行顺序处理，
 * 所以调用方拿到回执时，镜像已经应用过对应的事件。
 */

export interface EngineHostOptions {
  command: string;
  env?: NodeJS.ProcessEnv;
  log: Logger;
  onEvent: (event: VideoEvent) => void;
  /** 进程意外退出（不是 `close()` 引起的）。 */
  onExit: (info: { code: number | null; signal: NodeJS.Signals | null }) => void;
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** 引擎错误码到协议错误码（命令与协议规范 §11）。原样的错误体放在 `details` 里。 */
const CODE_MAP: [RegExp, RpcErrorCode][] = [
  [
    /^(PROJECT_REVISION_CONFLICT|IDEMPOTENCY_CONFLICT|UNDO_CONFLICT|UNDO_UNAVAILABLE|TIMELINE_OVERLAP|TARGET_LOCKED|VIDEO_LOCKED)$/,
    'conflict',
  ],
  [/^(ENTITY_NOT_FOUND|VIDEO_NOT_OPEN)$/, 'not-found'],
  [/^(INVALID_|TIME_|SOURCE_|MEDIA_|ASSET_|PACKAGE_|UNKNOWN_METHOD)/, 'invalid-request'],
  [/^VIDEO_READ_ONLY$/, 'forbidden'],
  // 停止屏障（§7.4）：不是冲突，不能按冲突重试。
  [/^TASK_STOPPED$/, 'forbidden'],
];

export function engineError(body: EngineErrorBody): RpcError {
  const code = CODE_MAP.find(([pattern]) => pattern.test(body.code))?.[1] ?? 'internal';
  // 引擎只给英文缺省文字与引用（命令与协议规范 §11.1）；按 Runtime 的语言展开，引用随错误一起交给客户端。
  return new RpcError(code, localizeText(body.message, body.messageRef), body, body.messageRef);
}

export class EngineHost {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #log: Logger;
  readonly #pending = new Map<number, Pending>();
  readonly #exited: Promise<void>;
  #nextId = 1;
  #closing = false;
  #alive = true;

  private constructor(child: ChildProcessWithoutNullStreams, options: EngineHostOptions) {
    this.#child = child;
    this.#log = options.log;
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => this.#onLine(line, options.onEvent));
    const errLines = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });
    errLines.on('line', (line) => this.#log.warn('Engine output', { line: line.slice(0, 500) }));
    child.stdin.on('error', () => {});
    this.#exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => {
        this.#alive = false;
        const error = new RpcError('engine-unavailable', RcVideo.engineExited());
        for (const pending of this.#pending.values()) pending.reject(error);
        this.#pending.clear();
        if (!this.#closing) {
          this.#log.error('Video engine exited unexpectedly', { code, signal });
          options.onExit({ code, signal });
        }
        resolve();
      });
    });
  }

  static start(options: EngineHostOptions): Promise<EngineHost> {
    return new Promise((resolve, reject) => {
      const child = spawn(options.command, [], { env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
      child.once('error', (error) => reject(new RpcError('engine-unavailable', RcVideo.engineStartFailed({ reason: error.message }))));
      child.once('spawn', () => {
        const host = new EngineHost(child, options);
        host.request<{ version: string; pid: number }>('host.hello', {}).then((hello) => {
          options.log.info('Video engine ready', hello);
          resolve(host);
        }, reject);
      });
    });
  }

  get alive(): boolean {
    return this.#alive;
  }

  get pid(): number | null {
    return this.#child.pid ?? null;
  }

  request<T>(method: string, params: unknown): Promise<T> {
    if (!this.#alive) return Promise.reject(new RpcError('engine-unavailable', RcVideo.engineNotRunning()));
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject });
      this.#child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  /** 关上 stdin：引擎处理完已收到的请求后退出，锁随进程释放。超时就强制结束。 */
  async close(timeoutMs = 5_000): Promise<void> {
    if (!this.#alive) return;
    this.#closing = true;
    this.#child.stdin.end();
    const timer = setTimeout(() => this.#child.kill('SIGKILL'), timeoutMs);
    await this.#exited;
    clearTimeout(timer);
  }

  #onLine(line: string, onEvent: (event: VideoEvent) => void): void {
    let message: { id?: number; result?: unknown; error?: unknown; event?: string; params?: unknown };
    try {
      message = JSON.parse(line);
    } catch {
      this.#log.warn('Engine output an unparseable line');
      return;
    }
    if (message.event === 'video.event') {
      try {
        onEvent(message.params as VideoEvent);
      } catch (error) {
        this.#log.error('Applying a video event failed', { error: String(error) });
      }
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    if (message.error !== undefined) {
      pending.reject(
        isEngineErrorBody(message.error) ? engineError(message.error) : new RpcError('internal', RcVideo.engineRequestFailed({ method: pending.method })),
      );
    } else pending.resolve(message.result);
  }
}

/**
 * 找 Engine Host 可执行文件：`BAOCUT_ENGINE_HOST` 环境变量；随应用分发的原生程序目录（`BAOCUT_BIN_DIR`、打包后的 `<resources>/bin`）；
 * 或者从本模块往上找 cargo 产物目录里的 `{release,debug}/engine-host`（开发时由 `npm run build:engine` 构建；目录跟随
 * `.cargo/config*.toml` 的 `build.target-dir`）。
 */
export function resolveEngineHostCommand(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.BAOCUT_ENGINE_HOST) return env.BAOCUT_ENGINE_HOST;
  return findBundledBinary('engine-host', path.dirname(fileURLToPath(import.meta.url)), env);
}
