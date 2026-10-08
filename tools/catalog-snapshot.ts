#!/usr/bin/env node
/**
 * CLI 的离线目录快照（Agent 面设计 §2.3）：`baocut --help`、`help <命令>` 与 `spec` 在没有 Runtime 时也要能用，按这份快照派生。
 *
 * 用 Runtime 组装的全部工具组（依赖是空的，只读 schema 与目录项）按终端的视图（`surfaces` 含 `cli`）列出，形状与网关
 * `catalog.list` 的结果完全相同，另带 `edits_ops` 的操作目录。写到 `apps/cli/src/generated/catalog.json`（生成物，不进 git）。
 *
 *   node tools/catalog-snapshot.ts          写快照
 *   node tools/catalog-snapshot.ts --check  快照与当前目录不一致（或没有）时退出码 1
 *
 * 根 `package.json` 的 `build:catalog`、`pretest` 与 `prebuild` 跑它；vitest 的 globalSetup 也在测试前写一次。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCP_INTERFACE_VERSION, type CatalogSnapshot } from '@baocut/protocol';
import { silentLogger } from '@baocut/harness';
import { ToolCatalog } from '../packages/runtime-core/src/agent-tools/tool-catalog.ts';
import { defaultToolRisk } from '../packages/runtime-core/src/agent-tools/tool-scope.ts';
import { editOperationsCatalog } from '../packages/runtime-core/src/agent-tools/video-tools.ts';
import { allToolSets } from '../packages/runtime-core/src/agent-tools/all-tool-sets.ts';

export const SNAPSHOT_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'cli',
  'src',
  'generated',
  'catalog.json',
);

/** 当前的目录快照：与 `catalog.list` 对终端的结果同形，加操作目录。 */
export function buildCatalogSnapshot(): CatalogSnapshot {
  const catalog = new ToolCatalog(allToolSets(), silentLogger, { surface: 'cli' });
  return {
    interfaceVersion: MCP_INTERFACE_VERSION,
    tools: catalog.list().map((tool) => ({ ...tool, risk: defaultToolRisk(tool.name) })),
    editOps: editOperationsCatalog(),
  };
}

/** 快照的文本（稳定的缩进，便于比较）。 */
export function snapshotText(snapshot: CatalogSnapshot = buildCatalogSnapshot()): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/** 写快照；内容没变时不动文件。返回是否写了。 */
export function writeCatalogSnapshot(file = SNAPSHOT_FILE): boolean {
  const text = snapshotText();
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (current === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(SNAPSHOT_FILE) ? fs.readFileSync(SNAPSHOT_FILE, 'utf8') : null;
    if (current !== snapshotText()) {
      process.stderr.write(`目录快照与当前的工具目录不一致：运行 npm run build:catalog（${SNAPSHOT_FILE}）\n`);
      process.exit(1);
    }
  } else {
    writeCatalogSnapshot();
  }
}
