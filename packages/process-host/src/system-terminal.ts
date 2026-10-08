import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProcessHostTools as T } from '@baocut/protocol/messages/process-host';

/**
 * 在系统终端里运行一条命令（架构设计 §12.9：要输入密码、要管理员权限的动作交给系统终端，由用户自己执行）。
 * 只负责把终端打开、把命令放进去；命令在终端里的结果 BaoCut 不知道，之后由界面重新探测。
 *
 * - macOS：在临时目录写一个 `.command` 脚本（0o700，先 `rm -f "$0"` 自删），用 `open <文件>` 打开。
 *   走用户默认的 `.command` 处理程序（通常是「终端」），不需要自动化权限，不用 osascript。
 *   脚本末尾 `exec "$SHELL" -l` 留住窗口，用户能看完输出、接着在里面操作。
 * - Windows：`cmd.exe /c start "" cmd.exe /k <命令>`。（未验证：没有 Windows 环境实测。）
 * - Linux：依次试 `x-terminal-emulator -e`、`gnome-terminal --`、`konsole -e`、`xterm -e`，
 *   都不在 PATH 上就返回 `unsupported`。（未验证：没有 Linux 桌面环境实测。）
 *
 * 命令是调用方从 Agent 的探测结果里取的固定字符串，不是用户或网页给的；这里仍然只接受单行，
 * 提示行（「BaoCut：运行 <命令>」）按 shell 单引号转义。
 */

export type TerminalStatus = 'opened' | 'unsupported';

export interface SystemTerminalResult {
  status: TerminalStatus;
  /** `unsupported` 的原因，写日志用。 */
  detail: string | null;
}

/** 与 `child_process.spawn` 同形；测试注入假的，不真的打开终端。 */
export type SpawnProcess = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface SystemTerminalOptions {
  platform?: NodeJS.Platform;
  spawn?: SpawnProcess;
  /** macOS 写 `.command` 脚本的目录（默认系统临时目录）。 */
  tmpDir?: string;
  /** Linux 找终端程序用的环境（默认当前进程的）。 */
  env?: NodeJS.ProcessEnv;
  /** Linux：这个终端程序在不在 PATH 上（默认在 `env.PATH` 里找可执行文件）。 */
  available?: (program: string) => Promise<boolean>;
}

/** Linux 上依次尝试的终端，以及「后面跟要运行的程序」的参数。 */
export const LINUX_TERMINALS: readonly { program: string; args: readonly string[] }[] = [
  { program: 'x-terminal-emulator', args: ['-e'] },
  { program: 'gnome-terminal', args: ['--'] },
  { program: 'konsole', args: ['-e'] },
  { program: 'xterm', args: ['-e'] },
];

/** POSIX shell 单引号转义。 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** 终端里先打印的那一行。 */
export function terminalBanner(command: string): string {
  return T.terminalBanner({ command }).text;
}

/** macOS 的 `.command` 脚本内容。 */
export function macCommandScript(command: string): string {
  return [
    '#!/bin/sh',
    // 打开即删：不在临时目录里留脚本。
    'rm -f "$0"',
    // `.command` 的工作目录不固定，登录、安装都从用户主目录开始，和新开一个终端窗口一致。
    'cd "$HOME" 2>/dev/null',
    'clear',
    `printf '%s\\n' ${shellQuote(terminalBanner(command))}`,
    command,
    // 留住窗口：命令结束后给用户一个登录 shell。
    'exec "${SHELL:-/bin/zsh}" -l',
    '',
  ].join('\n');
}

/** Linux 终端里 `sh -c` 的脚本。 */
export function posixTerminalScript(command: string): string {
  return `printf '%s\\n' ${shellQuote(terminalBanner(command))}; ${command}; exec "\${SHELL:-/bin/sh}" -l`;
}

export async function openSystemTerminal(command: string, options: SystemTerminalOptions = {}): Promise<SystemTerminalResult> {
  if (!command.trim() || /[\r\n\0]/.test(command)) throw new Error('The terminal command must be a single non-empty line');
  const platform = options.platform ?? process.platform;
  const run = options.spawn ?? spawn;
  if (platform === 'darwin') return openMac(command, run, options.tmpDir ?? os.tmpdir());
  if (platform === 'win32') return openWindows(command, run);
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') {
    const env = options.env ?? process.env;
    return openLinux(command, run, options.available ?? ((program) => onPath(program, env.PATH ?? '')));
  }
  return { status: 'unsupported', detail: `Unsupported platform ${platform}` };
}

async function openMac(command: string, run: SpawnProcess, tmpDir: string): Promise<SystemTerminalResult> {
  const file = path.join(tmpDir, `baocut-${crypto.randomBytes(6).toString('hex')}.command`);
  // `wx`：不覆盖已有文件；0o700：只有当前用户能读写执行。
  await fs.writeFile(file, macCommandScript(command), { flag: 'wx', mode: 0o700 });
  // umask 可能去掉执行位，再设一次。
  await fs.chmod(file, 0o700);
  const outcome = await exitOf(run('open', [file], { stdio: 'ignore' }));
  if (outcome.ok && outcome.code === 0) return { status: 'opened', detail: null };
  // 没打开，脚本不会自删。
  await fs.rm(file, { force: true }).catch(() => {});
  return { status: 'unsupported', detail: outcome.ok ? `open exited with code ${outcome.code}` : outcome.error };
}

async function openWindows(command: string, run: SpawnProcess): Promise<SystemTerminalResult> {
  // `start` 的第一个带引号的参数是窗口标题；verbatim 让 Node 不给参数再加引号，命令原样交给新的 cmd。
  const child = run('cmd.exe', ['/c', 'start', '""', 'cmd.exe', '/k', command], {
    stdio: 'ignore',
    detached: true,
    windowsVerbatimArguments: true,
    windowsHide: true,
  });
  const outcome = await exitOf(child);
  if (outcome.ok && outcome.code === 0) return { status: 'opened', detail: null };
  return { status: 'unsupported', detail: outcome.ok ? `start exited with code ${outcome.code}` : outcome.error };
}

async function openLinux(command: string, run: SpawnProcess, available: (program: string) => Promise<boolean>): Promise<SystemTerminalResult> {
  const tried: string[] = [];
  for (const terminal of LINUX_TERMINALS) {
    if (!(await available(terminal.program))) continue;
    tried.push(terminal.program);
    const child = run(terminal.program, [...terminal.args, 'sh', '-c', posixTerminalScript(command)], { stdio: 'ignore', detached: true });
    // 终端程序一直开着，不等它退出：起来了就算打开。
    const started = await spawnOf(child);
    if (started.ok) {
      child.unref();
      return { status: 'opened', detail: null };
    }
  }
  return { status: 'unsupported', detail: tried.length ? `No terminal could be started: ${tried.join(', ')}` : 'No terminal program found' };
}

type Outcome = { ok: true; code: number | null } | { ok: false; error: string };

function exitOf(child: ChildProcess): Promise<Outcome> {
  return new Promise((resolve) => {
    child.once('error', (error) => resolve({ ok: false, error: String(error) }));
    child.once('exit', (code) => resolve({ ok: true, code }));
  });
}

function spawnOf(child: ChildProcess): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    child.once('error', () => resolve({ ok: false }));
    child.once('spawn', () => resolve({ ok: true }));
  });
}

async function onPath(program: string, searchPath: string): Promise<boolean> {
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir) continue;
    try {
      await fs.access(path.join(dir, program), fs.constants.X_OK);
      return true;
    } catch {
      // 下一个目录。
    }
  }
  return false;
}
