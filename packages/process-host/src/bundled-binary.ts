import fs from 'node:fs';
import path from 'node:path';
import { cargoTargetDirs, findCargoBinary } from './cargo-target.ts';

/** 随应用分发的原生可执行文件所在目录的环境变量：桌面应用打包后由主进程给出 `<resources>/bin`。 */
export const BIN_DIR_ENV = 'BAOCUT_BIN_DIR';

/** 打包后的资源目录里放原生可执行文件的子目录（Worker、凭据助手，以及它们要的 DLL）。 */
export const RESOURCES_BIN_DIR = 'bin';

/** 可执行文件名：Windows 上补 `.exe`。 */
export function executableName(name: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? `${name}.exe` : name;
}

/**
 * 找随 BaoCut 构建的原生可执行文件（`engine-host`、`model-worker` 这些 Worker 与 `credential-helper`），`name` 不带后缀。
 * 各工具自己的环境变量（`BAOCUT_ENGINE_HOST` 等）由调用方先看；这里按次序找：
 * 1. `BAOCUT_BIN_DIR`：给了就只在那里找，没有就是没有，不换别的来源；
 * 2. 打包后的 `<resources>/bin`（`process.resourcesPath`；Runtime 以 Node 方式运行时不一定有，所以主进程经 1 告诉它）；
 * 3. 从 `startDir` 往上找 cargo 产物目录里的 `{release,debug}/<name>`，同目录取修改时间较新的文件，时间相同取 release
 *    （开发时由 `npm run build:engine` 构建，避免旧 release 遮住新 debug）。
 */
export function findBundledBinary(
  name: string,
  startDir: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const exe = executableName(name, platform);
  if (env[BIN_DIR_ENV]) {
    const candidate = path.join(env[BIN_DIR_ENV], exe);
    return isFile(candidate) ? candidate : null;
  }
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (resources) {
    const bundled = path.join(resources, RESOURCES_BIN_DIR, exe);
    if (isFile(bundled)) return bundled;
  }
  return findCargoBinary(startDir, exe, env);
}

/**
 * 找随 BaoCut 分发的第三方工具目录里的可执行文件（`<子目录>/<name>`，如内置的 audio.cpp 引擎 `audiocpp/audiocpp_cli`），`name` 不带
 * 后缀。次序同 `findBundledBinary`：`BAOCUT_BIN_DIR/<子目录>/`（给了就只在那里找）、打包后的 `<resources>/bin/<子目录>/`、开发时 cargo
 * 产物目录里的 `<子目录>/`（由下载脚本放进去，不分 release / debug）。
 */
export function findBundledTool(
  subdir: string,
  name: string,
  startDir: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const exe = executableName(name, platform);
  if (env[BIN_DIR_ENV]) {
    const candidate = path.join(env[BIN_DIR_ENV], subdir, exe);
    return isFile(candidate) ? candidate : null;
  }
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (resources) {
    const bundled = path.join(resources, RESOURCES_BIN_DIR, subdir, exe);
    if (isFile(bundled)) return bundled;
  }
  for (const dir of cargoTargetDirs(startDir, env)) {
    const candidate = path.join(dir, subdir, exe);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/**
 * 找随 BaoCut 分发的第三方组件目录（`<子目录>/`，如 Windows 上的 LiteRT-LM C 库 `litertlm-runtime/`），没有时 null。次序同
 * `findBundledTool`：`BAOCUT_BIN_DIR/<子目录>/`（给了就只在那里找）、打包后的 `<resources>/bin/<子目录>/`、开发时 cargo 产物目录里的
 * `<子目录>/`。只看目录在不在，里面齐不齐由调用方按清单判断。
 */
export function findBundledToolDir(subdir: string, startDir: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env[BIN_DIR_ENV]) {
    const candidate = path.join(env[BIN_DIR_ENV], subdir);
    return isDirectory(candidate) ? candidate : null;
  }
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (resources) {
    const bundled = path.join(resources, RESOURCES_BIN_DIR, subdir);
    if (isDirectory(bundled)) return bundled;
  }
  for (const dir of cargoTargetDirs(startDir, env)) {
    const candidate = path.join(dir, subdir);
    if (isDirectory(candidate)) return candidate;
  }
  return null;
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}
