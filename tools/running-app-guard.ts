// 构建前先看产物目录是不是正被运行中的应用使用（开发流程 §5.1）。
//
// `electron-vite build`（`npm run build`、`npm start` 启动前的构建，以及先构建的 check:*、bench:*、package:*）与 `electron-vite dev`
// 都把产物的子目录清空重写，哈希变了的旧 chunk 随之消失。从这份产物启动的应用还开着时，它之后按需载入的 chunk 就找不到了：
// 打开编辑器时预览报「Failed to fetch dynamically imported module」，只能重启。应用在跑的标志是它拉起的 Runtime：进程命令行里
// 有这份产物的 `main/runtime.js`（绝对路径，别的检出与 worktree 不算；退出时选了在后台继续的 Runtime 也算，它还在用这份产物）。
// 主进程最先构建，在它的 buildStart 里拦下，三个目录都还没动。`BAOCUT_BUILD_FORCE=1` 照样构建；列不出进程时只提醒，不拦。

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';

export interface ProcessInfo {
  pid: number;
  command: string;
}

/** Windows 上 PowerShell 默认按 OEM 代码页输出，路径里有非 ASCII 字符时会乱，先换成 UTF-8。 */
const WINDOWS_LIST =
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }';

/** 本机全部进程的 pid 与完整命令行：macOS / Linux 用 ps（`-ww` 不截断），Windows 用 PowerShell 读 Win32_Process。 */
export function listProcesses(platform: NodeJS.Platform = process.platform): ProcessInfo[] {
  const options = { encoding: 'utf8', timeout: 20_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true } as const;
  const output =
    platform === 'win32'
      ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_LIST], options)
      : execFileSync('ps', ['-A', '-ww', '-o', 'pid=,command='], options);
  return parseProcessList(output);
}

/** 每行「pid 命令行」。没有命令行的（Windows 的系统进程）跳过。 */
export function parseProcessList(output: string): ProcessInfo[] {
  const processes: ProcessInfo[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\S.*?)\s*$/.exec(line);
    if (match) processes.push({ pid: Number(match[1]), command: match[2]! });
  }
  return processes;
}

/** 命令行里有 `script` 这个完整参数的进程（不含自己）。Windows 上不分大小写与斜杠方向。 */
export function processesRunning(
  script: string,
  processes: readonly ProcessInfo[],
  platform: NodeJS.Platform = process.platform,
  self = process.pid,
): ProcessInfo[] {
  const normalize = (text: string) => (platform === 'win32' ? text.replaceAll('\\', '/').toLowerCase() : text);
  const target = normalize(script);
  return processes.filter(({ pid, command }) => pid !== self && hasArgument(normalize(command), target));
}

/** 前后是开头、结尾、空白或引号才算：`/a/out/main/runtime.js` 不匹配 `/tmp/a/out/main/runtime.js`。 */
function hasArgument(command: string, argument: string): boolean {
  for (let at = command.indexOf(argument); at !== -1; at = command.indexOf(argument, at + 1)) {
    const before = at === 0 ? ' ' : command[at - 1]!;
    const after = command[at + argument.length] ?? ' ';
    if (/[\s"']/.test(before) && /[\s"']/.test(after)) return true;
  }
  return false;
}

export function runningAppMessage(script: string, running: readonly ProcessInfo[]): string {
  const out = dirname(dirname(script));
  return [
    `${out} is in use: a BaoCut Runtime is running from ${script} (pid ${running.map(({ pid }) => pid).join(', ')}).`,
    'Rebuilding would delete the chunks that the running app loads on demand; its editor preview would then fail with "Failed to fetch dynamically imported module".',
    'Quit the app and build again. A Runtime left running in the background stops by itself once idle, or stop that process.',
    'To only check that the app builds, build outside the repo instead: npx electron-vite build --outDir <absolute path> (in apps/desktop).',
    'Set BAOCUT_BUILD_FORCE=1 to build here anyway.',
  ].join('\n');
}

/**
 * 放在 main 的插件里。产物位置取解析后的 `build.outDir`（`--outDir` 改到别处时就看那里有没有应用在跑）。只在第一次构建时查：
 * `electron-vite dev --watch` 之后的重新构建碰到的是这次开发自己拉起的应用。
 */
export function guardRunningApp(list: () => ProcessInfo[] = listProcesses): Plugin {
  let script = '';
  let checked = false;
  return {
    name: 'baocut:guard-running-app',
    apply: 'build',
    configResolved(config) {
      script = resolve(config.root, config.build.outDir, 'runtime.js');
    },
    buildStart() {
      if (checked) return;
      checked = true;
      if (process.env.BAOCUT_BUILD_FORCE === '1') return;
      let running: ProcessInfo[];
      try {
        running = processesRunning(script, list());
      } catch (error) {
        this.warn(`Could not list processes, so the build did not check for an app running from ${dirname(dirname(script))}: ${(error as Error).message}`);
        return;
      }
      if (running.length === 0) return;
      // `electron-vite dev` 只打印构建错误，进程随后以 0 退出：照样以失败退出。
      process.exitCode = 1;
      this.error(runningAppMessage(script, running));
    },
  };
}
