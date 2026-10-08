/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/acp-agent.ts 的 createLoggedNdJsonStream / normalizeACPIncomingMessage
 * （容忍非 JSON 行的 NDJSON 流）、summarizeACPRequestError / extractACPErrorDataMessage（错误原文）、
 * buildACPClientCapabilities（不提供文件读写与终端）、rejectOnSpawnError、terminateChildProcess。
 * 改成 BaoCut 的 Logger 与中文说明，去掉诊断表与导入历史。
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  type AnyMessage,
  type Client,
  type InitializeResponse,
  type Stream,
} from '@agentclientprotocol/sdk';
import { RUNTIME_VERSION, type Localized } from '@baocut/protocol';
import { DriversAcp, DriversCommon } from '@baocut/protocol/messages/agent-drivers';
import type { Logger } from '@baocut/harness';

/** ACP 的「需要登录」（`RequestError.authRequired`）。 */
export const ACP_AUTH_REQUIRED = -32000;
const METHOD_NOT_FOUND = -32601;

const STDERR_TAIL_BYTES = 4096;

/**
 * POSIX 上智能体进程自成一个进程组（`detached`），收拾时整组结束：智能体派生的进程不会因为只结束了智能体本身而留成孤儿。
 * cursor-agent 一启动就在工作目录里跑 `rg --files --follow` 为 @ 文件建索引，收到 SIGTERM 就退出、不管这个 rg；探测在家目录里
 * 起它，rg 卡在 iCloud 云盘目录的 `stat` 上时会一直留下去。Windows 没有进程组：按进程树结束（`taskkill /T /F`）。
 */
const PROCESS_GROUPS = process.platform !== 'win32';
/** 请停（SIGTERM）之后等多久强杀。 */
const STOP_GRACE_MS = 2_000;
/** 强杀之后最多等进程组消失多久（SIGKILL 不能被忽略，正常几毫秒就结束；这只是不让异常情况挂住关闭）。 */
const KILL_WAIT_MS = 5_000;
const GROUP_POLL_MS = 20;

/**
 * 还没收拾完的智能体进程。Runtime 退出时（包括停止途中还没探完的探测）同步强杀：自成一组的进程不随 Runtime 结束，
 * 有的智能体 stdin 关了也不退出（cursor-agent 就会一直留着）。
 */
const live = new Set<AcpProcess>();
let exitHookInstalled = false;

export interface AcpErrorLike {
  code: number;
  message: string;
  data?: unknown;
}

export function isAcpError(value: unknown): value is AcpErrorLike {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { code?: unknown }).code === 'number' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

export function isAuthRequired(error: unknown): boolean {
  return isAcpError(error) && error.code === ACP_AUTH_REQUIRED;
}

export function isMethodNotFound(error: unknown): boolean {
  return isAcpError(error) && error.code === METHOD_NOT_FOUND;
}

/** 错误原文：JSON-RPC 错误带上 `data` 里的说明（`details`、`message` 之类），别的取 message。 */
export function acpErrorMessage(error: unknown): string {
  if (isAcpError(error)) {
    const detail = dataMessage(error.data);
    return detail && detail !== error.message ? `${error.message}: ${detail}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function dataMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  for (const key of ['details', 'errorMessage', 'message', 'detail', 'title']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return dataMessage(record.error);
}

/** 超时就以 `message` 失败。 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * stdio 上的 JSON 行。SDK 自带的 `ndJsonStream` 遇到不是 JSON 的行会打到 console；有的智能体会往 stdout 混进日志行，
 * 这里记一条警告后跳过。字符串形式的数字 id 换回数字（有的智能体这样回应答）。
 */
export function acpNdJsonStream(output: WritableStream<Uint8Array>, input: ReadableStream<Uint8Array>, log: Logger): Stream {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const readable = new ReadableStream<AnyMessage>({
    async start(controller) {
      let buffer = '';
      const reader = input.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              controller.enqueue(normalizeIncoming(JSON.parse(trimmed) as AnyMessage));
            } catch {
              log.warn('ACP agent wrote a non-JSON line to stdout; ignored', { length: trimmed.length });
            }
          }
        }
      } catch (error) {
        log.debug('ACP stdout reading ended', { error: String(error) });
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
  const writable = new WritableStream<AnyMessage>({
    async write(message) {
      const writer = output.getWriter();
      try {
        await writer.write(encoder.encode(`${JSON.stringify(message)}\n`));
      } finally {
        writer.releaseLock();
      }
    },
  });
  return { readable, writable };
}

function normalizeIncoming(message: AnyMessage): AnyMessage {
  if ('id' in message && !('method' in message) && typeof message.id === 'string' && /^\d+$/.test(message.id)) {
    const id = Number(message.id);
    if (Number.isSafeInteger(id)) return { ...message, id } as AnyMessage;
  }
  return message;
}

export interface AcpProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  log: Logger;
  /** 给人看的名字，用在错误说明里。 */
  label: string;
  /** 处理智能体发来的请求与通知。 */
  client: Client;
  /** 启动到 `initialize` 应答的时限，默认 20 秒。 */
  initTimeoutMs?: number;
}

/**
 * 一个以 ACP 运行的智能体进程：spawn、接上连接、`initialize`。不提供文件读写与终端（智能体自己读写、自己跑命令），
 * 审批经 `session/request_permission` 回到 BaoCut。
 */
export class AcpProcess {
  readonly child: ChildProcess;
  readonly connection: ClientSideConnection;
  init!: InitializeResponse;
  /** 进程退出时 resolve：正常退出为 null，否则是说明（退出码、信号与 stderr 的结尾）。 */
  readonly exited: Promise<Localized | null>;
  readonly #log: Logger;
  readonly #label: string;
  #stderr = '';
  #closing = false;
  #exitedFlag = false;
  /** 进程组（Windows 上是进程树）已经收拾完：不再发信号，免得进程号被重用后误伤别的进程。 */
  #treeGone = false;

  private constructor(options: AcpProcessOptions) {
    this.#log = options.log;
    this.#label = options.label;
    this.child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: PROCESS_GROUPS,
    });
    AcpProcess.#track(this);
    this.child.stdin!.on('error', (error) => this.#log.debug('ACP stdin error', { error: String(error) }));
    this.child.stderr!.on('data', (chunk: Buffer) => {
      this.#stderr = (this.#stderr + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES);
    });
    this.exited = new Promise((resolve) => {
      this.child.once('error', (error) => {
        if (this.child.pid === undefined) this.#markTreeGone();
        if (this.#exitedFlag) return;
        this.#exitedFlag = true;
        resolve(DriversCommon.startFailed({ name: this.#label, error: error.message }));
      });
      this.child.once('exit', (code, signal) => {
        // 自己退出的（崩溃、stdin 关闭后退出）：它留下的进程已经没有用，立即强杀。关闭途中的由 close() 收拾。
        if (!this.#closing) void this.#killLeftovers();
        if (this.#exitedFlag) return;
        this.#exitedFlag = true;
        if (this.#closing || code === 0) resolve(null);
        else {
          const status = signal ?? DriversAcp.exitCode({ code: String(code) });
          resolve(DriversAcp.exited({ name: this.#label, status, tail: this.stderrTail() }));
        }
      });
    });
    const stream = acpNdJsonStream(
      Writable.toWeb(this.child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(this.child.stdout!) as ReadableStream<Uint8Array>,
      this.#log,
    );
    this.connection = new ClientSideConnection(() => options.client, stream);
  }

  static async start(options: AcpProcessOptions): Promise<AcpProcess> {
    const proc = new AcpProcess(options);
    const exitedEarly = proc.exited.then((reason) => {
      throw new Error(String(reason ?? DriversAcp.exitedBeforeInit({ name: options.label })));
    });
    try {
      proc.init = await withTimeout(
        Promise.race([
          proc.connection.initialize({
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
            clientInfo: { name: 'baocut', title: 'BaoCut', version: RUNTIME_VERSION },
          }),
          exitedEarly,
        ]),
        options.initTimeoutMs ?? 20_000,
        String(DriversAcp.initTimeout({ name: options.label })),
      );
      exitedEarly.catch(() => undefined);
      return proc;
    } catch (error) {
      exitedEarly.catch(() => undefined);
      // 连接先断、退出事件后到：等一下退出原因（带 stderr 的结尾），比「connection closed」有用。
      const reason = await withTimeout(proc.exited, 500, 'alive').catch(() => null);
      await proc.close();
      throw reason ? new Error(String(reason)) : error;
    }
  }

  get hasExited(): boolean {
    return this.#exitedFlag;
  }

  /** stderr 的最后一行非空内容（错误说明用）。 */
  stderrTail(): string {
    const lines = this.#stderr
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.at(-1)?.slice(0, 300) ?? '';
  }

  /**
   * 关掉进程，连同它派生的进程：关 stdin，整组 SIGTERM，2 秒后组里还有进程就整组 SIGKILL，等到组里没有进程。智能体已经自己
   * 退出了也照样收拾它留下的进程。Windows 上按进程树强杀（那里的 SIGTERM 本来就等于强杀）。
   */
  async close(): Promise<void> {
    this.#closing = true;
    if (!this.#exitedFlag) this.child.stdin?.end();
    if (!PROCESS_GROUPS) {
      await this.#killTree();
    } else {
      this.#signalGroup('SIGTERM');
      if (!(await this.#groupGone(STOP_GRACE_MS))) {
        this.#signalGroup('SIGKILL');
        await this.#groupGone(KILL_WAIT_MS);
      }
    }
    await this.exited;
  }

  /** 智能体自己退出后，强杀它留在组里的进程（Windows 上进程树随智能体断开，找不到了）。 */
  async #killLeftovers(): Promise<void> {
    if (!PROCESS_GROUPS) return this.#markTreeGone();
    this.#signalGroup('SIGKILL');
    await this.#groupGone(KILL_WAIT_MS);
  }

  #signalGroup(signal: NodeJS.Signals): void {
    const pid = this.child.pid;
    if (pid === undefined || this.#treeGone) return;
    try {
      process.kill(-pid, signal);
    } catch {
      // ESRCH：组里已经没有进程
    }
  }

  /** 等进程组里没有进程，最多等 `ms`；返回是否已经没有。 */
  async #groupGone(ms: number): Promise<boolean> {
    const deadline = performance.now() + ms;
    for (;;) {
      const pid = this.child.pid;
      if (pid === undefined || this.#treeGone) return true;
      try {
        process.kill(-pid, 0);
      } catch (error) {
        // ESRCH：组里没有进程了。EPERM 时还有：macOS 上组里的进程正在退出时是这样（也可能属于别的用户），接着等。
        if ((error as NodeJS.ErrnoException).code !== 'EPERM') {
          this.#markTreeGone();
          return true;
        }
      }
      if (performance.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, GROUP_POLL_MS));
    }
  }

  /** Windows：`taskkill /T` 顺着还在的智能体找到它派生的进程一起结束；taskkill 不可用时只结束智能体本身。 */
  async #killTree(): Promise<void> {
    const pid = this.child.pid;
    if (!this.#exitedFlag && pid !== undefined) {
      await new Promise<void>((resolve) =>
        execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: KILL_WAIT_MS }, () => resolve()),
      );
      if (!this.#exitedFlag) this.child.kill('SIGKILL');
    }
    this.#markTreeGone();
  }

  #markTreeGone(): void {
    this.#treeGone = true;
    live.delete(this);
  }

  static #track(proc: AcpProcess): void {
    live.add(proc);
    if (exitHookInstalled) return;
    exitHookInstalled = true;
    // 退出途中只能同步：POSIX 上整组强杀；Windows 上只结束智能体本身，不再等 taskkill。
    process.once('exit', () => {
      for (const p of live) {
        const pid = p.child.pid;
        if (pid === undefined || p.#treeGone) continue;
        try {
          if (PROCESS_GROUPS) process.kill(-pid, 'SIGKILL');
          else if (!p.#exitedFlag) p.child.kill('SIGKILL');
        } catch {
          // ESRCH：已经不在
        }
      }
    });
  }
}
