import path from 'node:path';
import type { CliEntryStatus } from '@baocut/protocol';
import { defineNoun } from './context.ts';
import { M } from './skills-copy.ts';

/**
 * 管理桶 `baocut cli install|status|remove`（CLI 独立使用与发布 §3.2）：让终端找到 `baocut`。macOS 与 Linux 在
 * `~/.local/bin/baocut` 放指向 App 入口的软链接，Windows 写转发脚本并把它的目录加进用户 PATH。位置、状态与装法都在 Runtime
 * 那边（`cliEntry.*`，与 App 的「安装命令行工具」同一份规则），CLI 只经协议。
 */
export const cliEntry = defineNoun({
  name: 'cli',
  verbs: ['install', 'status', 'remove'],
  get usage() {
    return M.cliHelp;
  },
  options: {},
  async run(ctx) {
    const [sub, ...extra] = ctx.args;
    if (extra.length > 0) throw ctx.usageError();
    const home = ctx.env.HOME || ctx.env.USERPROFILE || '';
    if (sub === 'status') {
      const status = await ctx.client.request('cliEntry.status', {});
      return ctx.done(status, formatCliEntryStatus(status, home), cliEntryNext(status));
    }
    if (sub === 'install') {
      const status = await ctx.client.request('cliEntry.install', {});
      return ctx.done(status, installedLines(status, home));
    }
    if (sub === 'remove') {
      const before = await ctx.client.request('cliEntry.status', {});
      const status = await ctx.client.request('cliEntry.remove', {});
      const tilde = tildeOf(home);
      return ctx.done(status, [before.state === 'none' ? M.cliNothingToRemove(tilde(status.path)) : M.cliRemoved(tilde(status.path))]);
    }
    throw ctx.usageError();
  },
});

/** 给人读的状态：放入口的位置与状态、App 入口、终端里实际会找到哪一个、要加进 PATH 的那一行。 */
export function formatCliEntryStatus(status: CliEntryStatus, home: string): string[] {
  const tilde = tildeOf(home);
  const lines = [
    M.cliStatusEntry(tilde(status.path), status.target && tilde(status.target), M.cliState[status.state]),
    M.cliStatusApp(status.entry && tilde(status.entry)),
  ];
  lines.push(...terminalLines(status, home));
  return lines;
}

function installedLines(status: CliEntryStatus, home: string): string[] {
  const tilde = tildeOf(home);
  const lines = [M.cliInstalled(tilde(status.path), tilde(status.target ?? status.entry ?? ''))];
  const windows = /\.cmd$/i.test(status.path);
  if (windows) lines.push(M.cliWindowsPath(dirOf(status.path)));
  lines.push(...terminalLines(status, home, windows));
  return lines;
}

/** 终端里的 `baocut`：查不出、没找到、找到的是别的那个；不在 PATH 上时要加的那一行。 */
function terminalLines(status: CliEntryStatus, home: string, quietWhenOurs = false): string[] {
  const tilde = tildeOf(home);
  const dir = tilde(dirOf(status.path));
  const lines: string[] = [];
  const shell = status.shell;
  if (!shell) lines.push(M.cliStatusUnchecked);
  else if (shell.found && !samePath(shell.found, status.path)) lines.push(M.cliShadowed(tilde(shell.found), dir));
  else if (!quietWhenOurs) lines.push(M.cliStatusTerminal(shell.found && tilde(shell.found)));
  if (status.pathHint) lines.push(M.cliPathHint(dir, status.pathHint.line, status.pathHint.file));
  return lines;
}

/** 没装、或装的不是这个 App 时的下一步。 */
function cliEntryNext(status: CliEntryStatus): string | null {
  if (!status.entry) return null;
  if (status.state === 'none') return M.cliInstallHint;
  if (status.state === 'stale' || status.state === 'broken') return M.cliFixHint;
  return null;
}

/** 让终端找到 App 自带的入口：用这个入口自己跑一次 `cli install`（还不在 PATH 上，所以写完整路径）；`cli status` 同理。 */
export function cliInstallCommand(entry: string, platform: NodeJS.Platform, verb: 'install' | 'status' = 'install'): string {
  return platform === 'win32' ? `"${entry}" cli ${verb}` : `'${entry.replace(/'/g, `'\\''`)}' cli ${verb}`;
}

function dirOf(file: string): string {
  return /\\/.test(file) && !file.includes('/') ? path.win32.dirname(file) : path.posix.dirname(file);
}

function tildeOf(home: string): (p: string) => string {
  return (p) => (home && (p === home || p.startsWith(home + '/') || p.startsWith(home + '\\')) ? `~${p.slice(home.length)}` : p);
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+$/, '');
  return /\\/.test(a) || process.platform === 'darwin' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}
