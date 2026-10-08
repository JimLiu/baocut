import { spawn, type ChildProcess } from 'node:child_process';
import { killProcessTree, type SpawnProcess } from '@baocut/process-host';

/**
 * 代用户执行一条命令（架构设计 §12.9 的更新动作）：不经 shell，标准输入关闭，输出按到达的顺序逐段交给调用方；
 * 停止时连同它派生的进程一起结束（POSIX 上是整个进程组，Windows 上是 taskkill /T 的进程树），超时同样处理。
 */

/** 输出的末尾：去掉终端颜色，`\r` 改写的行只留最后一次，超过上限时按整行截掉前面的。 */
export class CommandOutput {
  readonly #limit: number;
  /** 写完的行，每行以 `\n` 结尾。 */
  #done = '';
  /** 还没写完的那一行。 */
  #line = '';
  #lines = 0;
  #carriage = false;
  #truncated = false;

  constructor(limit: number) {
    this.#limit = limit;
  }

  push(chunk: string): void {
    // eslint-disable-next-line no-control-regex
    for (const piece of chunk.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').split(/(\r\n|\n|\r)/)) {
      if (piece === '\n' || piece === '\r\n') {
        this.#done += `${this.#line}\n`;
        this.#line = '';
        this.#lines += 1;
        this.#carriage = false;
      } else if (piece === '\r') this.#carriage = true;
      else if (piece) {
        if (this.#carriage) this.#line = '';
        this.#carriage = false;
        this.#line += piece;
      }
    }
    this.#trim();
  }

  get text(): string {
    return this.#done + this.#line;
  }

  get lines(): number {
    return this.#lines;
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  #trim(): void {
    if (this.#line.length > this.#limit) {
      this.#line = this.#line.slice(-this.#limit);
      this.#truncated = true;
    }
    const excess = this.#done.length + this.#line.length - this.#limit;
    if (excess <= 0) return;
    const cut = this.#done.indexOf('\n', excess - 1);
    this.#done = cut < 0 ? '' : this.#done.slice(cut + 1);
    this.#truncated = true;
  }
}

export type CommandOutcome =
  | { kind: 'exited'; exitCode: number }
  | { kind: 'signalled'; signal: string }
  | { kind: 'failed-to-start'; reason: string }
  | { kind: 'timed-out' }
  | { kind: 'aborted' };

export interface RunCommandOptions {
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  timeoutMs: number;
  onOutput(chunk: string): void;
  /** 先请程序结束、过多久没结束就强制结束。 */
  killGraceMs?: number;
  platform?: NodeJS.Platform;
  /** 测试注入；也用来起 Windows 上的 taskkill。 */
  spawn?: SpawnProcess;
}

export async function runCommand(argv: readonly string[], options: RunCommandOptions): Promise<CommandOutcome> {
  const platform = options.platform ?? process.platform;
  const posix = platform !== 'win32';
  const run = options.spawn ?? spawn;
  if (options.signal.aborted) return { kind: 'aborted' };
  return await new Promise<CommandOutcome>((resolve) => {
    let child: ChildProcess;
    try {
      child = run(argv[0]!, argv.slice(1), {
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // POSIX：自成一个进程组，停止时连同它派生的进程（brew 的 curl、pip 的构建）一起结束。
        detached: posix,
      });
    } catch (error) {
      resolve({ kind: 'failed-to-start', reason: String(error) });
      return;
    }
    let stopped: 'aborted' | 'timed-out' | null = null;
    let killTimer: NodeJS.Timeout | null = null;
    // Windows 的 taskkill /F 是强制结束，宽限期到了只是再结束一次。
    const kill = (signal: NodeJS.Signals) => killProcessTree(child, signal, { platform, spawn: run });
    const stop = (reason: 'aborted' | 'timed-out') => {
      if (stopped) return;
      stopped = reason;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), options.killGraceMs ?? 5_000);
    };
    const onAbort = () => stop('aborted');
    options.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => stop('timed-out'), options.timeoutMs);
    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => options.onOutput(chunk));
    child.stderr!.on('data', (chunk: string) => options.onOutput(chunk));
    let settled = false;
    const finish = (outcome: CommandOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options.signal.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    child.on('error', (error: NodeJS.ErrnoException) => finish({ kind: 'failed-to-start', reason: error.code ?? error.message }));
    child.on('close', (code, signal) => {
      if (stopped) finish({ kind: stopped });
      else if (code !== null) finish({ kind: 'exited', exitCode: code });
      else finish({ kind: 'signalled', signal: signal ?? 'unknown' });
    });
  });
}
