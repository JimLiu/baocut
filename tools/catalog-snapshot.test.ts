import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MCP_INTERFACE_VERSION } from '@baocut/protocol';
import { GLOBAL_FLAGS, flagSpecs } from '../apps/cli/src/catalog/flags.ts';
import { SNAPSHOT_FILE as CLI_SNAPSHOT_FILE } from '../apps/cli/src/catalog/snapshot.ts';
import { SNAPSHOT_FILE, buildCatalogSnapshot, snapshotText } from './catalog-snapshot.ts';

/** CLI 的离线目录快照（Agent 面设计 §2.3）：与当前的 `ToolCatalog` 对终端的视图一致，派生出的旗标不与 CLI 自己的重名。 */
describe('CLI 的目录快照', () => {
  it('快照文件与当前的工具目录一致', () => {
    expect(CLI_SNAPSHOT_FILE).toBe(SNAPSHOT_FILE);
    expect(fs.readFileSync(SNAPSHOT_FILE, 'utf8')).toBe(snapshotText());
  });

  it('只含终端的工具，带接口版本、效果、示例与操作目录', () => {
    const snapshot = buildCatalogSnapshot();
    expect(snapshot.interfaceVersion).toBe(MCP_INTERFACE_VERSION);
    expect(snapshot.tools.length).toBeGreaterThan(30);
    for (const tool of snapshot.tools) {
      expect(tool.surfaces).toContain('cli');
      expect(tool.examples.length).toBeGreaterThan(0);
      if (tool.positional) expect(Object.keys(tool.inputSchema.properties as object)).toContain(tool.positional);
    }
    expect(snapshot.editOps.families.length).toBeGreaterThan(0);
    for (const group of snapshot.editOps.families) {
      expect(group.family).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      for (const op of group.operations) expect(op.family).toBe(group.family);
    }
  });

  it('目录字段派生出的旗标不与 CLI 保留的重名（--dry-run 与 --project 是有意的）', () => {
    const collisions = new Set<string>();
    for (const tool of buildCatalogSnapshot().tools) {
      for (const spec of flagSpecs(tool.inputSchema)) {
        const names = [spec.flag, ...(spec.switch ? [`no-${spec.flag}`] : [])];
        for (const name of names) if ((GLOBAL_FLAGS as readonly string[]).includes(name)) collisions.add(`${tool.name}.${spec.field}`);
      }
    }
    for (const tool of buildCatalogSnapshot().tools) {
      const derived = flagSpecs(tool.inputSchema);
      for (const entry of tool.cliSwitches ?? []) {
        const clash =
          (GLOBAL_FLAGS as readonly string[]).includes(entry.flag) ||
          derived.some((spec) => spec.flag === entry.flag || (spec.switch && `no-${spec.flag}` === entry.flag)) ||
          !derived.some((spec) => spec.field === entry.field);
        if (clash) collisions.add(`${tool.name}.--${entry.flag}`);
      }
    }
    const intended = [...collisions].filter((entry) => !entry.endsWith('.dryRun') && !entry.endsWith('.project'));
    expect(intended).toEqual([]);
    expect([...collisions]).toContain('edits_apply.dryRun');
  });
});
