import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { SpawnProcess } from './system-terminal.ts';

/**
 * 结束一个子进程连同它派生的进程（更新命令里 pip 的构建、winget 的安装程序，yt-dlp 合并时起的 ffmpeg）。
 *
 * - POSIX：子进程要以 `detached` 启动，自成一个进程组（组号就是它的 pid），信号发给整组；组已经不在时退回给它自己发。
 * - Windows：没有进程组信号，`child.kill()` 只结束直接子进程。用 `taskkill /PID <pid> /T /F` 按父子关系结束整棵进程树；
 *   taskkill 不能启动时退回 `child.kill()`。`/F` 是强制结束，没有先请它退出的一步：调用方的宽限期在 Windows 上只是再杀一次。
 *   父进程已经退出的孙进程不在树里，找不到（未在 Windows 上验证）。
 */

export interface KillProcessTreeOptions {
  platform?: NodeJS.Platform;
  spawn?: SpawnProcess;
  /** 找 taskkill 用的环境（`SystemRoot`）；默认当前进程的。 */
  env?: NodeJS.ProcessEnv;
}

export function killProcessTree(child: Pick<ChildProcess, 'pid' | 'kill'>, signal: NodeJS.Signals, options: KillProcessTreeOptions = {}): void {
  const platform = options.platform ?? process.platform;
  const pid = child.pid;
  if (platform === 'win32') {
    if (pid === undefined) {
      safeKill(child, signal);
      return;
    }
    const run = options.spawn ?? spawn;
    try {
      run(taskkillPath(options.env ?? process.env), ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () =>
        safeKill(child, signal),
      );
    } catch {
      safeKill(child, signal);
    }
    return;
  }
  if (pid === undefined) {
    safeKill(child, signal);
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    safeKill(child, signal);
  }
}

/** System32 里的 taskkill（不在 PATH 里找，免得被同名程序顶替）。 */
export function taskkillPath(env: NodeJS.ProcessEnv): string {
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || env.WINDIR || 'C:\\Windows';
  return path.win32.join(root, 'System32', 'taskkill.exe');
}

function safeKill(child: Pick<ChildProcess, 'kill'>, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    // 已经结束了。
  }
}
