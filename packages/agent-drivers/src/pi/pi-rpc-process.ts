/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/jsonl-rpc-process.ts 的 JsonlRpcProcess（`req_N` 请求号、挂起表、逐请求超时、
 * requestStopWork、stderr 尾部、关闭时 stdin end → SIGTERM → SIGKILL）与 jsonl-frame-decoder.ts 的分行（只按 LF 切、去掉行尾 CR）。
 * 改成 BaoCut 的 Logger 与 Node 自带的 spawn；去掉 rpc_chunk 分片（v2）与进程树清理。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Localized } from '@baocut/protocol';
import { DriversPi } from '@baocut/protocol/messages/agent-drivers';
import type { Logger } from '@baocut/harness';
import { LocalizedError } from '../driver-text.ts';

const STDERR_LIMIT = 8192;
const GRACEFUL_MS = 2_000;
const FORCE_MS = 1_000;
export const PI_RPC_DEFAULT_TIMEOUT_MS = 30_000;

export interface PiRpcLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
}

export type PiCommand = { type: string; [key: string]: unknown };

/**
 * `pi --mode rpc` 的一个子进程：stdin 写命令（每行一个 JSON，带 `id`），stdout 读应答（`type: 'response'`，`id` 对上）与事件（没有 `id`）。
 *
 * 分行只认 LF：JSON 字符串里可能有 U+2028 / U+2029，Node 的 readline 会在那里切开，所以不用它。
 */
export class PiRpcProcess {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #log: Logger;
  readonly #pending = new Map<string, Pending>();
  readonly #listeners = new Set<(message: Record<string, unknown>) => void>();
  #buffer = '';
  #stderr = '';
  #nextId = 1;
  #disposed = false;
  #exited = false;
  #closing: Promise<void> | null = null;
  /** 进程退出时完成，值是退出的说明（码、信号与 stderr 尾部）。 */
  readonly exited: Promise<Localized>;

  constructor(launch: PiRpcLaunch, log: Logger) {
    this.#log = log;
    this.#child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.#child.stdout.setEncoding('utf8');
    this.#child.stderr.setEncoding('utf8');
    this.#child.stdout.on('data', (chunk: string) => this.#read(chunk));
    this.#child.stderr.on('data', (chunk: string) => {
      this.#stderr = (this.#stderr + chunk).slice(-STDERR_LIMIT);
    });
    this.#child.stdin.on('error', (error) => this.#stdinFailed(error));
    this.exited = new Promise((resolve) => {
      let settled = false;
      const done = (reason: Localized) => {
        if (settled) return;
        settled = true;
        this.#exited = true;
        this.#failAll(new LocalizedError(reason));
        resolve(reason);
      };
      this.#child.on('error', (error) => done(DriversPi.processStartFailed({ error: error.message })));
      this.#child.on('exit', (code, signal) => {
        const tail = this.stderrTail();
        done(DriversPi.processExited({ code: String(code ?? 'null'), signal: String(signal ?? 'null'), tail }));
      });
    });
  }

  get hasExited(): boolean {
    return this.#exited;
  }

  /** stderr 最后几行，报错时附上。 */
  stderrTail(): string {
    return this.#stderr.trim().split('\n').slice(-5).join('\n');
  }

  onMessage(listener: (message: Record<string, unknown>) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 发一条命令，等应答的 `data`；`success: false` 时以它的 `error` 失败。`timeoutMs` 为 null 时只等应答、退出或关闭。 */
  request(command: PiCommand, timeoutMs: number | null = PI_RPC_DEFAULT_TIMEOUT_MS): Promise<unknown> {
    if (this.#disposed) return Promise.reject(new Error(String(DriversPi.processClosed())));
    const id = `req_${this.#nextId++}`;
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs !== null && timeoutMs > 0
          ? setTimeout(() => {
              this.#pending.delete(id);
              reject(new Error(String(DriversPi.requestTimeout({ command: command.type, ms: String(Date.now() - started) }))));
            }, timeoutMs)
          : null;
      this.#pending.set(id, { resolve, reject, timer });
      this.send({ ...command, id });
    });
  }

  /**
   * 目的是「让它停下」的命令（abort、clear_queue）：进程已经退了就算达成，不报错。
   * 子进程临死前 stdin 先断、请求先失败，这时等关闭结束再看它是不是真的退了。
   */
  async requestStopWork(command: PiCommand, timeoutMs: number | null = PI_RPC_DEFAULT_TIMEOUT_MS): Promise<void> {
    if (this.#exited) return;
    try {
      await this.request(command, timeoutMs);
    } catch (error) {
      await this.#closing?.catch(() => undefined);
      if (!this.#exited) throw error;
    }
  }

  /** 不等应答的消息（extension_ui_response 之类）。 */
  send(message: Record<string, unknown>): void {
    if (this.#disposed) return;
    if (this.#child.stdin.destroyed || !this.#child.stdin.writable) {
      this.#stdinFailed(new Error(String(DriversPi.stdinUnwritable())));
      return;
    }
    try {
      this.#child.stdin.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      this.#stdinFailed(error);
    }
  }

  /** 关掉：先关 stdin 让它自己退，2 秒不退发 SIGTERM，再 1 秒发 SIGKILL。 */
  close(): Promise<void> {
    if (!this.#closing) {
      this.#failAll(new Error(String(DriversPi.processClosed())));
      this.#closing = this.#terminate();
    }
    return this.#closing;
  }

  async #terminate(): Promise<void> {
    if (this.#exited) return;
    try {
      this.#child.stdin.end();
    } catch {
      // 关闭时的竞争，忽略。
    }
    const wait = (ms: number) =>
      Promise.race([this.exited.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms).unref())]);
    if (await wait(GRACEFUL_MS)) return;
    this.#child.kill('SIGTERM');
    if (await wait(GRACEFUL_MS)) return;
    this.#log.warn('Pi process did not exit after SIGTERM; sending SIGKILL');
    this.#child.kill('SIGKILL');
    if (!(await wait(FORCE_MS))) this.#log.warn('Pi process still has not reported exit after SIGKILL');
  }

  #read(chunk: string): void {
    this.#buffer += chunk;
    let newline = this.#buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.#buffer.slice(0, newline).replace(/\r$/, '');
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line.trim()) this.#line(line);
      newline = this.#buffer.indexOf('\n');
    }
  }

  #line(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.#log.debug('Ignoring a non-JSON line from Pi', { line: line.slice(0, 200) });
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const message = parsed as Record<string, unknown>;
    if (message.type === 'response') {
      this.#response(message);
      return;
    }
    for (const listener of this.#listeners) {
      try {
        listener(message);
      } catch (error) {
        this.#log.error('Handling a Pi event failed', { error: String(error) });
      }
    }
  }

  #response(message: Record<string, unknown>): void {
    const id = typeof message.id === 'string' ? message.id : null;
    const pending = id ? this.#pending.get(id) : undefined;
    if (!pending) {
      // 没有 id 的应答：命令本身不是合法 JSON（`command: 'parse'`）。我们不会发出那样的命令，记一下即可。
      if (message.success === false) this.#log.warn('Pi sent an error response with no matching request', { error: String(message.error ?? '') });
      return;
    }
    if (pending.timer) clearTimeout(pending.timer);
    this.#pending.delete(id!);
    if (message.success === false) {
      pending.reject(
        new Error(typeof message.error === 'string' && message.error ? message.error : String(DriversPi.commandFailed({ command: String(message.command) }))),
      );
      return;
    }
    pending.resolve(message.data);
  }

  #stdinFailed(error: unknown): void {
    if (this.#disposed) return;
    this.#log.warn("Writing to Pi's stdin failed", { error: error instanceof Error ? error.message : String(error) });
    // 多半是进程正在退出：稍等它的 exit，让挂着的请求带着真实的退出原因（stderr）失败；还不退再关。
    setTimeout(() => {
      if (!this.#exited) void this.close();
    }, 500).unref();
  }

  #failAll(error: Error): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const pending of this.#pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

export function piErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
