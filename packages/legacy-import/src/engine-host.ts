// i18n-ignore-file: Historical import report vocabulary is retained for compatibility with archived reports.
// Engine Host 的最小客户端：stdin/stdout 每行一个 JSON（见 crates/engine-host/src/main.rs）。
// 脚本不依赖 packages/ 里的协议类型：这里只声明导入用到的几个形状。

import os from 'node:os';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface EngineError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  entityIds?: string[];
}

export class EngineFailure extends Error {
  readonly body: EngineError;
  constructor(method: string, body: EngineError) {
    super(`${method}: ${body.code} ${body.message}`);
    this.body = body;
  }
}

export interface Receipt {
  transactionId: string;
  videoRevision: string;
  createdIds: string[];
  updatedIds: string[];
  refs?: Record<string, string>;
  /** 单侧转场写入之后，因为实例不到转场的两倍长而变短的那些（生效长度）。 */
  impact?: { shortenedTransitions?: { id: string; durationFrames: number; effectiveFrames: number }[] };
}

const ACTOR = { kind: 'system', id: 'legacy-import' };

export class EngineHost {
  #child: ChildProcessWithoutNullStreams;
  #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; method: string }>();
  #nextId = 1;
  #closed = false;

  constructor(binary: string, ffprobe: string) {
    this.#child = spawn(binary, [], { env: { ...process.env, BAOCUT_FFPROBE: ffprobe }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.#child.once('spawn', () => {
      try {
        if (this.#child.pid) os.setPriority(this.#child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        /* Optional on restricted hosts. */
      }
    });
    this.#child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    this.#child.stdin.on('error', () => {});
    this.#child.on('error', (error) => {
      this.#closed = true;
      for (const { reject } of this.#pending.values()) reject(error);
      this.#pending.clear();
    });
    this.#child.on('exit', (code) => {
      this.#closed = true;
      for (const { reject, method } of this.#pending.values()) reject(new Error(`engine-host 退出（${code}），${method} 没有完成`));
      this.#pending.clear();
    });
    createInterface({ input: this.#child.stdout }).on('line', (line) => {
      const message = JSON.parse(line) as { id?: number; result?: unknown; error?: EngineError; event?: string };
      if (message.event || message.id == null) return;
      const waiting = this.#pending.get(message.id);
      if (!waiting) return;
      this.#pending.delete(message.id);
      if (message.error) waiting.reject(new EngineFailure(waiting.method, message.error));
      else waiting.resolve(message.result);
    });
  }

  request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error('Import engine is closed'));
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject, method });
      this.#child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  /** 提交一笔事务。`commandId` 相同、内容相同的重试返回同一张回执，所以整个导入可以重跑。 */
  async apply(videoId: string, commandId: string, label: string, operations: unknown[]): Promise<Receipt> {
    const { revision } = await this.request<{ revision: string }>('videos.inspect', { path: this.#paths.get(videoId) });
    const result = await this.request<{ receipt: Receipt }>('edits.apply', {
      videoId,
      commandId,
      expectedRevision: revision,
      label,
      operations,
      actor: ACTOR,
    });
    return result.receipt;
  }

  #paths = new Map<string, string>();

  remember(videoId: string, path: string): void {
    this.#paths.set(videoId, path);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#child.stdin.end();
    const timer = setTimeout(() => this.#child.kill('SIGKILL'), 2000);
    timer.unref();
    this.#child.once('exit', () => clearTimeout(timer));
  }
}
