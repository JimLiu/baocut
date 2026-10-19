#!/usr/bin/env node
/**
 * 随 App 打包的说明书（Agent 面设计 §8.2）：把 `skills/baocut/` 按 CLI 面渲染进一个目录，打包脚本放到
 * `<resources>/agent-skill/baocut/`。给外部 Agent 装的软链接指向它，App 更新时它跟着换，装过的不用重装。
 *
 * 目录用 Runtime 组装的全部工具组对终端的视图（与 `tools/catalog-snapshot.ts` 相同）；Runtime 里 `catalog.agentSkill`
 * 与开发时的 `agentSkill.*` 用同一个渲染器、同一份目录，结果相同。
 *
 *   node tools/render-agent-skill.ts --out <目录>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { silentLogger } from '@baocut/harness';
import { ToolCatalog } from '../packages/runtime-core/src/agent-tools/tool-catalog.ts';
import { allToolSets } from '../packages/runtime-core/src/agent-tools/all-tool-sets.ts';
import { AGENT_SKILL_ID, renderAgentSkill } from '../packages/runtime-core/src/skills/agent-skill-renderer.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 渲染进 `out`（先清空）。返回写了几个文件。 */
export function renderBundledAgentSkill(out: string, source = path.join(ROOT, 'skills', AGENT_SKILL_ID)): number {
  const catalog = new ToolCatalog(allToolSets(), silentLogger, { surface: 'cli' });
  const files = renderAgentSkill(source, { face: 'cli', catalog: { tools: catalog.list() } });
  fs.rmSync(out, { recursive: true, force: true });
  for (const [file, content] of files) {
    const abs = path.join(out, ...file.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return files.size;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) {
    process.stderr.write('Usage: node tools/render-agent-skill.ts --out <dir>\n');
    process.exit(2);
  }
  const count = renderBundledAgentSkill(path.resolve(values.out));
  console.log(`Rendered the BaoCut agent skill (${count} files) into ${values.out}`);
}
