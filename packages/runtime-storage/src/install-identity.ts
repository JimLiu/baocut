import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 一份安装的身份（CLI 独立使用与发布 §4.1）：Runtime 写进发现信息的 `entry` 与 `build`，桌面端据此判断后台的 Runtime 是不是
 * 自己这一份、同不同一次构建。桌面端主进程与 Runtime 入口对同一个入口文件（`out/main/runtime.js` 或 `apps/runtime/src/main.ts`）
 * 调用，得到同样的结果。
 */

/**
 * 构建时注入的 commit 短号（electron-vite 的 `define`，见 `apps/desktop/electron.vite.config.ts`），开发构建带未提交改动时带
 * `-dirty`。从源码直接运行时没有。
 */
declare const __BAOCUT_BUILD__: unknown;

export function injectedBuild(): string | null {
  return typeof __BAOCUT_BUILD__ === 'string' && __BAOCUT_BUILD__ ? __BAOCUT_BUILD__ : null;
}

/**
 * 入口文件属于哪一份安装：在 `app.asar` 里时是 App 包（macOS 的 `BaoCut.app`，其余平台是 `resources` 的上一级，即安装目录）；
 * 否则往上找仓库根（`package.json` 的 name 是 `baocut`）。都认不出时 null。
 */
export function installEntryOf(script: string, platform: NodeJS.Platform = process.platform): string | null {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const resolved = paths.resolve(script);
  const parts = resolved.split(paths.sep);
  const asar = parts.lastIndexOf('app.asar');
  if (asar > 0) {
    const resources = parts.slice(0, asar).join(paths.sep) || paths.sep;
    return platform === 'darwin' ? paths.dirname(paths.dirname(resources)) : paths.dirname(resources);
  }
  return repoRootOf(paths.dirname(resolved));
}

/** 往上找仓库根（`package.json` 的 name 是 `baocut`）。 */
export function repoRootOf(start: string): string | null {
  for (let dir = start; ; dir = path.dirname(dir)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: unknown };
      if (pkg.name === 'baocut') return dir;
    } catch {
      // 继续往上。
    }
    if (path.dirname(dir) === dir) return null;
  }
}

/** 在 `cwd` 里跑一条 git 命令，取标准输出；失败、超时或没有 git 时 null。 */
export function git(cwd: string, args: readonly string[], timeoutMs = 3_000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', [...args], { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : stdout);
    });
  });
}

/** 仓库此刻的构建号：HEAD 的短号，工作区有未提交改动时加 `-dirty`。不是 git 仓库或查不出时 null。 */
export async function repoBuild(root: string, timeoutMs = 3_000): Promise<string | null> {
  const [head, status] = await Promise.all([
    git(root, ['rev-parse', '--short', 'HEAD'], timeoutMs),
    git(root, ['status', '--porcelain', '--untracked-files=no'], timeoutMs),
  ]);
  const commit = head?.trim();
  if (!commit) return null;
  return status === null || status.trim() === '' ? commit : `${commit}-dirty`;
}

/**
 * 这份安装的构建号：构建时注入的优先；从源码运行（仓库入口）时问 git。查不出时 null。
 */
export async function installBuild(entry: string | null): Promise<string | null> {
  const injected = injectedBuild();
  if (injected) return injected;
  if (!entry || !fs.existsSync(path.join(entry, '.git'))) return null;
  return repoBuild(entry);
}
