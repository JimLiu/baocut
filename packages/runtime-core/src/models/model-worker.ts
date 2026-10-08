import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findBundledBinary } from '@baocut/process-host';

/** 启动 Model Worker 的命令。Runtime 会在 `args` 后面追加 `--parent-pid <pid>`。 */
export interface ModelWorkerCommand {
  command: string;
  args?: string[];
}

/**
 * 找 Model Worker 可执行文件：`BAOCUT_MODEL_WORKER` 环境变量；随应用分发的原生程序目录（`BAOCUT_BIN_DIR`、打包后的 `<resources>/bin`）；
 * 或者从本模块往上找 cargo 产物目录里的 `{release,debug}/model-worker`（开发时用 cargo 构建；目录跟随 `.cargo/config*.toml` 的
 * `build.target-dir`）。找不到时为 null：本地推理不可用。
 */
export function resolveModelWorkerCommand(env: NodeJS.ProcessEnv = process.env): ModelWorkerCommand | null {
  if (env.BAOCUT_MODEL_WORKER) return { command: env.BAOCUT_MODEL_WORKER };
  const found = findBundledBinary('model-worker', path.dirname(fileURLToPath(import.meta.url)), env);
  return found ? { command: found } : null;
}
