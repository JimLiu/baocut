import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CatalogSnapshot } from '@baocut/protocol';

/**
 * 构建期的目录快照（Agent 面设计 §2.3）：`--help`、`help <命令>` 与 `spec` 不连 Runtime 时按它派生。由
 * `tools/catalog-snapshot.ts` 生成（`npm run build:catalog`），不进 git。连得上 Runtime 时执行命令一律以 `catalog.list` 为准。
 *
 * 按路径读而不是静态 import：快照不在时 CLI 照样能加载，只是离线的帮助给出生成命令。
 */
export const SNAPSHOT_FILE = fileURLToPath(new URL('../generated/catalog.json', import.meta.url));

/** 生成快照的命令（快照缺失时提示）。 */
export const SNAPSHOT_COMMAND = 'npm run build:catalog';

export function loadSnapshot(file = SNAPSHOT_FILE): CatalogSnapshot | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const parsed = JSON.parse(text) as CatalogSnapshot;
  return Array.isArray(parsed.tools) && typeof parsed.interfaceVersion === 'string' ? parsed : null;
}
