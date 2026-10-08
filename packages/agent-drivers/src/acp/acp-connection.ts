/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/acp-agent.ts 的 createLoggedNdJsonStream / normalizeACPIncomingMessage
 * （容忍非 JSON 行的 NDJSON 流）、summarizeACPRequestError / extractACPErrorDataMessage（错误原文）、
 * buildACPClientCapabilities（不提供文件读写与终端）、rejectOnSpawnError、terminateChildProcess。
 * 改成 BaoCut 的 Logger 与中文说明，去掉诊断表与导入历史。
 */
import { spawn, type ChildProcess } from 'node:child_process';
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

  private constructor(options: AcpProcessOptions) {
    this.#log = options.log;
    this.#label = options.label;
    this.child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin!.on('error', (error) => this.#log.debug('ACP stdin error', { error: String(error) }));
    this.child.stderr!.on('data', (chunk: Buffer) => {
      this.#stderr = (this.#stderr + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES);
    });
    this.exited = new Promise((resolve) => {
      this.child.once('error', (error) => {
        if (this.#exitedFlag) return;
        this.#exitedFlag = true;
        resolve(DriversCommon.startFailed({ name: this.#label, error: error.message }));
      });
      this.child.once('exit', (code, signal) => {
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

  /** 关掉进程：先关 stdin 与 SIGTERM，2 秒后还在就 SIGKILL。 */
  async close(): Promise<void> {
    this.#closing = true;
    if (this.#exitedFlag) return;
    this.child.stdin?.end();
    this.child.kill('SIGTERM');
    const killed = await withTimeout(
      this.exited.then(() => true),
      2000,
      'timeout',
    ).catch(() => false);
    if (!killed) {
      this.child.kill('SIGKILL');
      await this.exited;
    }
  }
}
