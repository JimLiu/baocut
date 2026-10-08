import fs from 'node:fs';
import path from 'node:path';
import { findCargoBinary } from './cargo-target.ts';

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
 * 3. 从 `startDir` 往上找 cargo 产物目录里的 `{release,debug}/<name>`（开发时由 `npm run build:engine` 构建）。
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

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}
