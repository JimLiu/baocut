import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RpcError } from '@baocut/protocol';
import { ModelsModelAssets as M } from '@baocut/protocol/messages/models/model-assets.ts';
import type { ModelText } from './model-text.ts';

/**
 * 随应用分发、按路径读的模型数据（`packages/models/assets/`：自测样本、内置音色的参考录音）。路径会交给 Model Worker 读，
 * 所以必须是磁盘上的真实文件，不能在 asar 里。
 *
 * 不能用 `new URL('../assets/…', import.meta.url)`：Runtime 被打进桌面端的 `out/main/runtime.js` 之后，`import.meta.url` 是 bundle，
 * 相对路径就指到 `out/assets/` 去了。与内置模板（`resolveBuiltinTemplatesDir`）同一个办法，按次序找：
 * 1. `BAOCUT_MODEL_ASSETS_DIR` 环境变量（打包后的应用由主进程给出 `<resources>/model-assets`）；
 * 2. 打包后的资源目录 `<resources>/model-assets`；
 * 3. 从本模块往上找仓库里的 `packages/models/assets`（源码运行、测试、CLI 与开发时的桌面构建）。
 */
export const MODEL_ASSETS_ENV = 'BAOCUT_MODEL_ASSETS_DIR';

const RESOURCES_DIR = 'model-assets';
const IN_REPO = path.join('packages', 'models', 'assets');

/** 模型数据目录；都找不到时 null。每次调用都重新找（环境变量在调用时读）。 */
export function resolveModelAssetsDir(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env[MODEL_ASSETS_ENV]) return env[MODEL_ASSETS_ENV];
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (resources) {
    const bundled = path.join(resources, RESOURCES_DIR);
    if (isDirectory(bundled)) return bundled;
  }
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, IN_REPO);
    if (isDirectory(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * 一个随应用分发的文件（`asset` 是相对模型数据目录的路径，以 `/` 分隔）的绝对路径；找不到目录时 null。
 * 不检查文件在不在：读的地方读不出来时报 `appFileMissing`。
 */
export function modelAssetPath(asset: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const dir = resolveModelAssetsDir(env);
  return dir ? path.join(dir, ...asset.split('/')) : null;
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** 随应用分发的文件缺失或读不出来的错误码（命令与协议规范 §11.3）。 */
export const APP_FILE_MISSING = 'APP_FILE_MISSING';

/**
 * 随应用分发的文件缺失或读不出来：是安装的问题，不是用户给的输入，也不是模型的问题。`what` 是给人看的名字（「识别检查的样本」）；
 * 句子里不带路径：`details.asset` 是模型数据目录里的相对路径（不知道时 null），期望的位置在 `details.file`（找不到模型数据目录时 null）。`RpcError.code` 为 `conflict`，错误码在 `details.code`。
 */
export function appFileMissing(what: ModelText, asset: string | null, file: string | null): RpcError {
  return new RpcError('conflict', M.appFileMissing({ what }), {
    code: APP_FILE_MISSING,
    asset,
    file,
  });
}
