import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogTool } from '@baocut/protocol';
import {
  COMMON_OPS,
  REPO_ROOT,
  buildAgentSkillSync,
  diffAgentSkillSync,
  writeAgentSkillSync,
  type SyncInputs,
} from './sync-agent-skill.ts';

const FIXTURE = path.join(REPO_ROOT, 'packages/runtime-core/src/skills/testing/agent-skill-fixture');
const SCRIPT = path.join(REPO_ROOT, 'tools/sync-agent-skill.ts');
const AGENT = 'agent-skills/baocut';

function tool(name: string, effect: CatalogTool['effect'], surfaces: CatalogTool['surfaces'] = ['agent', 'mcp', 'cli']): CatalogTool {
  return { name, title: name, description: name, inputSchema: { type: 'object' }, risk: 'low', effect, examples: [], surfaces };
}

/** 固定的小目录：断言不随真实目录的说明文字变化。 */
const INPUTS: SyncInputs = {
  cliTools: [
    tool('assets_import', 'mutation'),
    tool('captions_create', 'mutation'),
    tool('documents_put', 'mutation'),
    tool('documents_read', 'query'),
    tool('edits_apply', 'mutation'),
    tool('edits_ops', 'query'),
    tool('jobs_wait', 'query'),
    tool('transcribe', 'job'),
    tool('videos_frames', 'query'),
    tool('videos_inspect', 'query'),
    tool('videos_import_package', 'mutation', ['agent', 'cli']),
  ],
  agentToolNames: [
    'assets_import',
    'captions_create',
    'documents_put',
    'documents_read',
    'downloads_save',
    'edits_apply',
    'edits_ops',
    'jobs_wait',
    'skills_read',
    'transcribe',
    'videos_frames',
    'videos_import_package',
    'videos_inspect',
  ],
  editOps: {
    conventions: '',
    families: [
      {
        family: 'timeline',
        operations: COMMON_OPS.map(({ op }) => ({
          type: op,
          family: 'timeline',
          description: `${op}(…)：${op} 的第一句。第二句不要。`,
          schema: {},
          example: { type: op },
        })),
      },
    ],
  },
  exitCodes: {
    CAPABILITY_NOT_CONFIGURED: 2,
    RUNTIME_UNAVAILABLE: 3,
    INVALID_ARGUMENTS: 4,
    UNKNOWN_TOOL: 4,
    RUNTIME_NOT_OWNED: 1,
    RUNTIME_IN_USE: 1,
    AGENT_SKILL_NOT_FOUND: 1,
    AGENT_SKILL_INVALID: 1,
    SOME_FAILURE: 1,
  },
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** 夹具复制一份到临时目录，生成块清空、craft 副本删掉，从「没同步过」开始。 */
function freshFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-sync-agent-skill-'));
  dirs.push(root);
  fs.cpSync(FIXTURE, root, { recursive: true });
  const agentDir = path.join(root, AGENT);
  for (const id of ['demo-polish', 'demo-chapters']) fs.rmSync(path.join(agentDir, 'references/craft', `${id}.md`), { force: true });
  for (const file of ['references/catalog/editing.md', 'references/conventions.md', 'references/mcp.md']) {
    const abs = path.join(agentDir, file);
    fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace(/(<!-- generated: [a-z-]+ -->\n)[\s\S]*?(<!-- \/generated -->)/g, '$1$2'));
  }
  return root;
}

const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('说明书的同步', () => {
  it('craft 副本：去 front matter，正文的一级标题作标题，references 作附录，工具名与 skills_read 按 CLI 面改写', () => {
    const root = freshFixture();
    const result = buildAgentSkillSync(root, INPUTS);
    expect(result.files.get(`${AGENT}/references/craft/demo-polish.md`)).toBe(
      [
        '<!-- 由 tools/sync-agent-skill.ts 从 skills/demo-polish/ 生成，不要手改：改源文件后运行 npm run build:agent-skill -->',
        '',
        '# 润色一份转写',
        '',
        '> 测试用的 craft：润色一份转写。只用于渲染器与同步脚本的测试。',
        '',
        '动笔前先读本页的附录「底本与默认值」：底本与默认值都在那里。',
        '',
        '1. 用 `baocut documents read` 读出转写，确认 sourceBasis。',
        '2. 一词对一词地改，用 `baocut documents put` 写回同一份文档；改完用 `baocut videos inspect` 核对版本。',
        '3. 交付时把文件的路径告诉用户（终端里没有下载目录这一步：文件就在你写的位置）。',
        '4. 章节交给 [demo-chapters](demo-chapters.md)，那一步用 `baocut edits apply` 的 setChapters。',
        '',
        '## 附录：底本与默认值',
        '',
        '### 底本',
        '',
        '先通读，定下底本。要改的地方多时，做法在 附录「底本与默认值」 本页，不另取。',
        '',
        '### 默认值',
        '',
        '- 只改错字与标点。',
        '',
      ].join('\n'),
    );
    expect(result.files.get(`${AGENT}/references/craft/demo-chapters.md`)).toContain(
      '转写还没润色时先读 [`references/craft/demo-polish.md`](demo-polish.md)。',
    );
    // 只在会话里有的工具：有兜底写法的（downloads_save）换掉、不提醒；没有的原样留下并提醒。
    expect(result.warnings).toEqual([]);
    fs.appendFileSync(path.join(root, 'skills/demo-polish/SKILL.md'), '\n收尾时更新 tasks_contract。\n');
    const withContract = buildAgentSkillSync(root, { ...INPUTS, agentToolNames: [...INPUTS.agentToolNames, 'tasks_contract'] });
    expect(withContract.warnings).toEqual([
      'skills/demo-polish/SKILL.md:16：tasks_contract 只在 BaoCut 的会话里有，CLI 面没有对应的命令，原样留下',
    ]);
  });

  it('craft 引用共享目录页：生成可解析链接、不复制表格，缺失目标时同步失败', () => {
    const root = freshFixture();
    const shared = `${AGENT}/references/catalog/voice-language-rates.md`;
    const body = '# 共享语速\n\n| Language | Rate |\n| --- | --- |\n| English | 2.1 |\n';
    fs.writeFileSync(path.join(root, shared), body);
    fs.appendFileSync(
      path.join(root, 'skills/demo-polish/SKILL.md'),
      '\n用 `skills_read` 读 `baocut-catalog-voice-language-rates`。\n',
    );
    const result = buildAgentSkillSync(root, INPUTS);
    const craft = result.files.get(`${AGENT}/references/craft/demo-polish.md`)!;
    expect(craft).toContain('[baocut-catalog-voice-language-rates](../catalog/voice-language-rates.md)');
    expect(craft).not.toContain('| English | 2.1 |');
    expect(read(root, shared)).toBe(body);
    expect(result.warnings).toEqual([]);
    fs.rmSync(path.join(root, shared));
    expect(() => buildAgentSkillSync(root, INPUTS)).toThrow('references/catalog/voice-language-rates.md');
  });

  it('一级动词也按 CLI 面改写；连着 -、/、. 或后跟 : 的不算工具名；代码块里不加反引号', () => {
    const root = freshFixture();
    fs.appendFileSync(
      path.join(root, 'skills/demo-polish/SKILL.md'),
      [
        '',
        '链接时 transcribe 给 `url`（或带 `transcribe: true`）；章节见 [demo-chapters](demo-chapters.md)，transcribe-only 的产物在 transcribe/ 下，脚本是 transcribe.ts。',
        '',
        '```bash',
        'transcribe --url x',
        '```',
        '',
      ].join('\n'),
    );
    const result = buildAgentSkillSync(root, INPUTS);
    const text = result.files.get(`${AGENT}/references/craft/demo-polish.md`)!;
    expect(text).toContain(
      '链接时 `baocut transcribe` 给 `url`（或带 `transcribe: true`）；章节见 [demo-chapters](demo-chapters.md)，transcribe-only 的产物在 transcribe/ 下，脚本是 transcribe.ts。',
    );
    expect(text).toContain('```bash\nbaocut transcribe --url x\n```');
    expect(result.warnings).toEqual([]);
  });

  it('三个生成块：common-ops、按面分开的 error-codes、只给 CLI 面的 tool-map', () => {
    const root = freshFixture();
    const files = buildAgentSkillSync(root, INPUTS).files;
    const editing = files.get(`${AGENT}/references/catalog/editing.md`)!;
    for (const { op, label } of COMMON_OPS) {
      expect(editing).toContain(`**${label}**（\`${op}\`）：${op} 的第一句。\n\n\`\`\`json\n{"type":"${op}"}\n\`\`\``);
    }
    expect(editing).not.toContain('第二句不要');
    expect(editing).toContain('字幕层用 {{tool:captions_create}} 建');

    const conventions = files.get(`${AGENT}/references/conventions.md`)!;
    expect(conventions).toContain(
      ['<!-- generated: error-codes -->', '<!-- surface: cli -->', '| 错误码 | 退出码 | 下一步 |', '| --- | --- | --- |'].join('\n'),
    );
    expect(conventions).toContain('| `CAPABILITY_NOT_CONFIGURED` | 2 |');
    expect(conventions).toContain('| `INVALID_ARGUMENTS` `UNKNOWN_TOOL` | 4 |');
    // 退出码 1 的行按下一步分开：同一句的并成一行，没单独写下一步的用「其他错误码」那句。
    expect(conventions).toContain('| `RUNTIME_NOT_OWNED` `RUNTIME_IN_USE` | 1 | Runtime 不归这个 CLI 停');
    expect(conventions).toContain('| `AGENT_SKILL_NOT_FOUND` `AGENT_SKILL_INVALID` | 1 | 说明书装不了');
    expect(conventions).toMatch(/\| `SOME_FAILURE` \| 1 \| 失败或取消。/);
    expect(conventions).toContain('<!-- surface: agent -->\n| 错误码 | 下一步 |\n| --- | --- |\n| `CAPABILITY_NOT_CONFIGURED` |');

    // mcp.md 的块已经在 cli 段里，不再包一层。
    const mcp = files.get(`${AGENT}/references/mcp.md`)!;
    expect(mcp).toContain(
      '<!-- generated: tool-map -->\n| MCP 工具 | CLI 命令 | 效果 |\n| --- | --- | --- |\n| `assets_import` | `baocut assets import` | mutation |',
    );
    expect(mcp).toContain('| `transcribe` | `baocut transcribe` | job |');
    expect(mcp).toContain('只在 CLI 里、MCP 上没有的：`baocut videos import-package`。\n<!-- /generated -->');
  });

  it('写盘后 --check 一致；README.md 不归脚本管，多出来的 craft 页算过期并删掉', () => {
    const root = freshFixture();
    const craftDir = path.join(root, AGENT, 'references/craft');
    fs.writeFileSync(path.join(craftDir, 'old-one.md'), '# 过期\n');
    const readme = read(root, `${AGENT}/references/craft/README.md`);

    const first = buildAgentSkillSync(root, INPUTS);
    expect(first.stale).toEqual([`${AGENT}/references/craft/old-one.md`]);
    expect(writeAgentSkillSync(root, first)).toContain(`${AGENT}/references/craft/old-one.md`);
    expect(fs.existsSync(path.join(craftDir, 'old-one.md'))).toBe(false);
    expect(read(root, `${AGENT}/references/craft/README.md`)).toBe(readme);
    expect(diffAgentSkillSync(root, buildAgentSkillSync(root, INPUTS))).toEqual([]);
  });

  it('改写不了的 skills_read 说法报错，带源文件与行号', () => {
    const root = freshFixture();
    fs.appendFileSync(path.join(root, 'skills/demo-chapters/SKILL.md'), '\n不确定时用 `skills_read` 看看别的。\n');
    expect(() => buildAgentSkillSync(root, INPUTS)).toThrow(
      /^skills\/demo-chapters\/SKILL\.md:13：这种 `skills_read` 的说法没法改写成 CLI 面/,
    );
  });

  it('生成后两个面都要渲染得过：占位符写错时失败', () => {
    const root = freshFixture();
    fs.appendFileSync(path.join(root, AGENT, 'references/workflows.md'), '\n4. {{tool:no_such}}\n');
    expect(() => buildAgentSkillSync(root, INPUTS)).toThrow('references/workflows.md:9：{{tool:no_such}}：CLI 面的目录里没有这个工具');
  });

  it('命令行：--check 不一致时退出码 1，写入后为 0', () => {
    const root = freshFixture();
    const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' });
    const before = run('--check');
    expect(before.status).toBe(1);
    expect(before.stderr).toContain('说明书与来源不一致');
    expect(run().status).toBe(0);
    expect(run('--check').status).toBe(0);
  });

  it('仓库里的说明书与来源一致（不一致时运行 npm run build:agent-skill）', () => {
    expect(diffAgentSkillSync(REPO_ROOT, buildAgentSkillSync(REPO_ROOT))).toEqual([]);
  });
});
