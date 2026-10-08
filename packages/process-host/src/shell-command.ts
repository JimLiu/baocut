import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { killProcessTree } from './process-tree.ts';
import type { SpawnProcess } from './system-terminal.ts';

/**
 * 在后台进程里跑一条 shell 命令，把输出按行交出来（Agent 的安装、升级命令在设置页里运行，架构设计 §12.9）。
 *
 * - 经 shell 运行（Unix 是 `/bin/sh -c`，Windows 是 `cmd.exe /d /s /c`）：命令是探测结果里的固定字符串，例如
 *   `brew upgrade codex`；调用方负责只交来这样的命令。
 * - stdin 关闭；Unix 上放进自己的会话（`detached`），没有控制终端：`sudo` 之类要密码的会立刻失败，不会挂住。
 * - stdout 与 stderr 合并，按行送出。进度条用的 `\r` 只留最后一段，终端控制序列（颜色、光标）去掉，一行过长时截断。
 * - `cancel()`：Unix 先给整个进程组 SIGTERM，宽限期后 SIGKILL；Windows 用 `taskkill /T /F` 结束进程树（未验证）。
 */

export interface ShellCommandOptions {
  command: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** 每一批新的输出行。 */
  onLines: (lines: string[]) => void;
  /** `cancel()` 之后多久强制结束（默认 3 秒）。 */
  killGraceMs?: number;
  /** 一行最多保留的字符数（默认 2000）。 */
  maxLineChars?: number;
  platform?: NodeJS.Platform;
  spawn?: SpawnProcess;
}

export interface ShellCommandExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** 退出由 `cancel()` 引起。 */
  cancelled: boolean;
  /** 没能启动的原因（例如 shell 不存在）；启动了为 null。 */
  error: string | null;
}

export interface ShellCommandRun {
  readonly pid: number | undefined;
  readonly exited: Promise<ShellCommandExit>;
  cancel(): void;
}

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** 去掉终端控制序列，`\r` 覆盖写只留最后一段非空内容。 */
export function cleanOutputLine(raw: string, maxChars = 2000): string {
  const segments = raw.replace(ANSI, '').split('\r');
  let line = '';
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i]!.length > 0) {
      line = segments[i]!;
      break;
    }
  }
  // 其他控制字符（退格、响铃）不进界面；制表符留着。
  line = line.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  return line.length > maxChars ? `${line.slice(0, maxChars)}…` : line;
}

export function runShellCommand(options: ShellCommandOptions): ShellCommandRun {
  const platform = options.platform ?? process.platform;
  const run = options.spawn ?? spawn;
  const windows = platform === 'win32';
  const maxLineChars = options.maxLineChars ?? 2000;
  let cancelled = false;
  let finished = false;
  let killTimer: NodeJS.Timeout | null = null;

  let child: ChildProcess;
  try {
    child = windows
      ? run(options.env?.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${options.command}"`], {
          env: options.env,
          cwd: options.cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsVerbatimArguments: true,
          windowsHide: true,
        })
      : run('/bin/sh', ['-c', options.command], {
          env: options.env,
          cwd: options.cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        });
  } catch (error) {
    return { pid: undefined, exited: Promise.resolve({ code: null, signal: null, cancelled: false, error: String(error) }), cancel() {} };
  }

  // 两路各自按行切，切好的行合进同一个输出。
  const readers = [child.stdout, child.stderr].map((stream) => {
    const decoder = new StringDecoder('utf8');
    let pending = '';
    const flush = (text: string, end: boolean) => {
      pending += text;
      const parts = pending.split('\n');
      pending = end ? '' : parts.pop()!;
      const lines = parts.filter((part, index) => !(end && index === parts.length - 1 && part === '')).map((part) => cleanOutputLine(part, maxLineChars));
      if (lines.length) options.onLines(lines);
    };
    stream?.on('data', (chunk: Buffer) => flush(decoder.write(chunk), false));
    return { end: () => flush(decoder.end(), true) };
  });

  const exited = new Promise<ShellCommandExit>((resolve) => {
    let spawnError: string | null = null;
    child.once('error', (error) => {
      spawnError = String(error);
      // 没能启动时不会有 close。
      if (child.pid === undefined) settle(null, null);
    });
    child.once('close', (code, signal) => settle(code, signal));
    // 命令留下的后台进程可能一直占着输出管道，`close` 就不来：进程退出后最多再等 2 秒。
    let closeTimer: NodeJS.Timeout | null = null;
    child.once('exit', (code, signal) => {
      closeTimer = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        settle(code, signal);
      }, 2000);
      closeTimer.unref?.();
    });
    function settle(code: number | null, signal: NodeJS.Signals | null) {
      if (finished) return;
      finished = true;
      if (killTimer) clearTimeout(killTimer);
      if (closeTimer) clearTimeout(closeTimer);
      for (const reader of readers) reader.end();
      resolve({ code, signal, cancelled, error: spawnError });
    }
  });

  return {
    pid: child.pid,
    exited,
    cancel() {
      if (finished || cancelled) return;
      cancelled = true;
      if (child.pid === undefined) return;
      const tree = { platform, spawn: run };
      // Windows：taskkill /T /F 结束 cmd 下面的 npm、node，没有宽限这一步。（未验证。）
      killProcessTree(child, 'SIGTERM', tree);
      if (windows) return;
      killTimer = setTimeout(() => killProcessTree(child, 'SIGKILL', tree), options.killGraceMs ?? 3000);
      killTimer.unref?.();
    },
  };
}
