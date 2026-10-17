import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@baocut/harness';
import { allToolSets } from '../agent-tools/all-tool-sets.ts';
import { ToolCatalog } from '../agent-tools/tool-catalog.ts';
import {
  AgentSkillRenderError,
  agentPageId,
  countHardRules,
  craftIdsOf,
  readAgentSkillDir,
  renderAgentGuidance,
  renderAgentSkill,
  renderAgentSkillText,
  renderSessionOnlyTools,
  resolveBuiltinAgentSkillsDir,
  SESSION_ONLY_TOOLS,
  type AgentSkillFiles,
} from './agent-skill-renderer.ts';
import { findRepoDir, resolveBuiltinSkillsDir } from './skill-catalog.ts';
import { parseSkillFrontmatter } from './skill-frontmatter.ts';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'testing', 'agent-skill-fixture', 'skills', 'baocut');
const cliCatalog = new ToolCatalog(allToolSets(), silentLogger, { surface: 'cli' });
const agentCatalog = new ToolCatalog(allToolSets(), silentLogger, { surface: 'agent' });
const CLI = { tools: cliCatalog.list() };
const AGENT = { tools: agentCatalog.list() };
/** 复合工具名（`a_b`）：终端目录里的与只在会话里有的（`downloads_save` 这类），CLI 面渲染后都不该再出现。 */
const CLI_COMPOUND = [...new Set([...CLI.tools, ...AGENT.tools].map((tool) => tool.name))].filter((name) => name.includes('_'));

/**
 * 只属于工具桥面（会话内智能体）的说法：审批与停止的错误码、编辑器上下文、工具桥本身。CLI 面里出现就是漏标了 surface。
 * `skills_read` 的「现取」在 CLI 面渲染成 `baocut skills read`，所以 `skills_read` 本身也不该出现。
 */
const BRIDGE_ONLY_TERMS = ['APPROVAL_DENIED', 'APPROVAL_CANCELLED', 'TASK_STOPPED', '<baocut-editor-context>', '工具桥', '访问模式'];

/**
 * §8.6 的第一条：CLI 面里不出现 `a_b` 形式的工具名，也不出现 `skills_read` 的「现取」说法以外的工具桥用语。mcp.md 整页与
 * tool-map 块豁免（那里本来就是 MCP 工具名的对照表）。
 */
function bridgeNamesInCliFace(files: AgentSkillFiles): string[] {
  const hits: string[] = [];
  for (const [file, text] of files) {
    if (file === 'references/mcp.md') continue;
    const body = text.replace(/<!-- generated: tool-map -->[\s\S]*?<!-- \/generated -->/g, '');
    for (const name of [...CLI_COMPOUND, 'skills_read']) {
      if (new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(body)) hits.push(`${file}: ${name}`);
    }
    for (const term of BRIDGE_ONLY_TERMS) if (body.includes(term)) hits.push(`${file}: ${term}`);
  }
  return hits;
}

/** §8.6 的第二条：工具桥面里不出现 `baocut <命令>`、`--yes` 与别的旗标、退出码。 */
function cliTracesInAgentFace(files: AgentSkillFiles): string[] {
  const hits: string[] = [];
  for (const [file, text] of files) {
    text.split('\n').forEach((line, index) => {
      if (/(?<![.\w])baocut [a-z]/.test(line) || /(?<![\w-])--[a-z]/.test(line) || /退出码/.test(line)) {
        hits.push(`${file}:${index + 1}: ${line}`);
      }
    });
  }
  return hits;
}

describe('说明书的渲染器', () => {
  const source = readAgentSkillDir(FIXTURE);

  it('CLI 面：工具名换成命令、参数换成旗标、craft 换成相对链接，没有工具桥的写法', () => {
    const cli = renderAgentSkill(source, { face: 'cli', catalog: CLI });
    const skill = cli.get('SKILL.md')!;
    expect(skill).toContain('先 `baocut documents read`，译完用 `baocut documents put` 写回');
    expect(skill).toContain('再按新的 `--revision` 提交（字段写成 `--expected-revision`）');
    expect(skill).toContain('润色的做法见 [demo-polish](references/craft/demo-polish.md)。');
    // 代码块里不套反引号。
    expect(skill).toContain('```text\nbaocut edits apply --expected-revision 12\n```');
    // 另一面的段落连同标记行删掉；页面链接原样。
    expect(skill).toContain('细节见 [start](references/start.md)，走 MCP 见 [mcp](references/mcp.md)');
    expect(skill).not.toContain('工具已经接好');
    expect(skill).not.toMatch(/<!-- \/?surface/);
    // 从 references/ 下的页面引用 craft 时按该页计算相对路径。
    expect(cli.get('references/catalog/editing.md')).toContain('剪口播的做法见 [demo-polish](../craft/demo-polish.md)。');
    expect(cli.get('references/workflows.md')).toContain('按 [demo-polish](craft/demo-polish.md) 润色');
    expect(cli.get('references/workflows.md')).toContain('带 `--source-document` 写译文');
    // 生成块的标记行保留，里面的占位符照样渲染。
    expect(cli.get('references/conventions.md')).toContain('<!-- generated: error-codes -->');
    expect(cli.get('references/conventions.md')).toContain('| 错误码 | 退出码 | 下一步 |');
    expect(cli.get('references/conventions.md')).not.toContain('{{');
    expect(cli.has('references/craft/demo-polish.md')).toBe(true);
    expect(bridgeNamesInCliFace(cli)).toEqual([]);
  });

  it('读说明书目录时跳过同目录下的 built-in-skills/：内置 skill 本身不是说明书的页，也不随 CLI 面装进宿主', () => {
    expect(fs.existsSync(path.join(FIXTURE, 'built-in-skills', 'demo-polish', 'SKILL.md'))).toBe(true);
    expect([...source.keys()].filter((file) => file.startsWith('built-in-skills/'))).toEqual([]);
  });

  it('工具桥面：工具名与字段名原样，craft 与页面链接换成 skills_read，没有 CLI 的痕迹', () => {
    const agent = renderAgentSkill(source, { face: 'agent', catalog: AGENT });
    const skill = agent.get('SKILL.md')!;
    expect(skill).toContain('先 `documents_read`，译完用 `documents_put` 写回');
    expect(skill).toContain('再按新的 `revision` 提交（字段写成 `expectedRevision`）');
    expect(skill).toContain('润色的做法见 `demo-polish`（用 `skills_read` 读）。');
    expect(skill).toContain('```text\nedits_apply expectedRevision 12\n```');
    expect(skill).toContain('工具已经接好，直接按任务读一页目录。');
    expect(skill).toContain('| editing（用 `skills_read` 读 `baocut-catalog-editing`） | 时间线上的修改 |');
    // 锚点去掉；工具桥面没有的页（start.md）退成纯文字。
    expect(skill).toContain(
      '端到端的做法在 workflows（用 `skills_read` 读 `baocut-workflows`），错误怎么处理见 conventions（用 `skills_read` 读 `baocut-conventions`），启动细节在 start。',
    );
    expect(agent.get('references/catalog/media.md')).toContain('要剪就去 editing（用 `skills_read` 读 `baocut-catalog-editing`）');
    expect(agent.get('references/conventions.md')).toContain('| 错误码 | 下一步 |');
    // craft 副本是给外部 Agent 的，工具桥面不输出。
    expect([...agent.keys()].some((file) => file.startsWith('references/craft/'))).toBe(false);
    expect(cliTracesInAgentFace(agent)).toEqual([]);
  });

  it('两个面的硬规则条数相同', () => {
    const cli = renderAgentSkill(source, { face: 'cli' }).get('SKILL.md')!;
    const agent = renderAgentSkill(source, { face: 'agent' }).get('SKILL.md')!;
    expect(countHardRules(cli)).toBe(5);
    expect(countHardRules(agent)).toBe(5);
    expect(countHardRules('# 无关\n- 一条')).toBe(0);
    expect(countHardRules('## 5. 硬规则\n\n1. 甲\n2. 乙\n   - 子项不算\n\n## 6. 交付\n- 不算')).toBe(2);
  });

  it('craft 的 id 只认小写连字符名，README.md 不算', () => {
    expect([...craftIdsOf(source)!].sort()).toEqual(['demo-chapters', 'demo-polish']);
    expect(craftIdsOf(['references/craft/README.md'])).toBeNull();
    expect(agentPageId('references/catalog/media.md')).toBe('baocut-catalog-media');
    expect(agentPageId('references/craft/demo-polish.md')).toBe('demo-polish');
    expect(agentPageId('references/craft/README.md')).toBeNull();
    expect(agentPageId('references/mcp.md')).toBeNull();
  });

  it('工具桥面的指导与内置页面', () => {
    const { guidance, pages } = renderAgentGuidance(source, AGENT);
    expect(guidance.startsWith('# BaoCut')).toBe(true);
    expect(guidance).not.toContain('description:');
    expect(pages.map((page) => page.id)).toEqual([
      'baocut-catalog-editing',
      'baocut-catalog-media',
      'baocut-workflows',
      'baocut-conventions',
    ]);
    const editing = pages.find((page) => page.id === 'baocut-catalog-editing')!;
    expect(editing.name).toBe('剪辑');
    expect(editing.description).toBe('edits apply 的操作族、剪口播、章节、撤销与读回执。');
    expect(editing.body).not.toContain('<!--');
    const media = pages.find((page) => page.id === 'baocut-catalog-media')!;
    expect(media.name).toBe('素材');
    expect(media.description).toBe('导入一个文件用 `assets_import`，取帧用 `videos_frames`。');
  });
});

describe('只给 CLI 面的目录页', () => {
  const source = readAgentSkillDir(FIXTURE);
  const cliOnly = [
    '---',
    'description: 只给终端里的 Agent 的一页。',
    '---',
    '',
    '<!-- surface: cli -->',
    '# 网页',
    '',
    '终端里的 Agent 用 {{tool:videos_list}} 找到视频，再开网页。',
    '<!-- /surface -->',
    '',
  ].join('\n');
  const withPage = (extra: Record<string, string>): AgentSkillFiles => new Map([...source, ...Object.entries(extra)]);

  it('工具桥面正文为空（只剩 front matter 与标题）的页不登记成说明书页；CLI 面照常有这一页', () => {
    const files = withPage({ 'references/catalog/web.md': cliOnly });
    const { pages } = renderAgentGuidance(files, AGENT);
    expect(pages.map((page) => page.id)).not.toContain('baocut-catalog-web');
    expect(pages.map((page) => page.id)).toContain('baocut-catalog-media');
    // 标题在 cli 块外面也一样：只有标题不算正文。
    const titled = cliOnly.replace('<!-- surface: cli -->\n# 网页', '# 网页\n\n<!-- surface: cli -->');
    expect(renderAgentGuidance(withPage({ 'references/catalog/web.md': titled }), AGENT).pages.map((p) => p.id)).not.toContain(
      'baocut-catalog-web',
    );
    const cli = renderAgentSkill(files, { face: 'cli', catalog: CLI }).get('references/catalog/web.md')!;
    expect(cli).toContain('# 网页');
    expect(cli).toContain('`baocut videos list`');
  });

  it('两面都有的正文链到这一页时报错：链接要放进 cli 面', () => {
    const linked = (where: string) =>
      withPage({
        'references/catalog/web.md': cliOnly,
        'references/catalog/media.md': `${source.get('references/catalog/media.md')!}\n${where}\n`,
      });
    expect(() => renderAgentGuidance(linked('要在编辑器里看就读 [web](web.md)。'), AGENT)).toThrow(/baocut-catalog-web/);
    expect(
      renderAgentGuidance(linked('<!-- surface: cli -->\n要在编辑器里看就读 [web](web.md)。\n<!-- /surface -->'), AGENT).pages,
    ).toHaveLength(renderAgentGuidance(source, AGENT).pages.length);
  });
});

describe('工具桥面的 craft 引用读起来通顺', () => {
  const agent = (text: string) => renderAgentSkillText(text, { face: 'agent', file: 'references/workflows.md' });
  const cli = (text: string) => renderAgentSkillText(text, { face: 'cli', file: 'references/workflows.md' });

  it('跟在「见」「参见」「做法在」「按」、表格与列举后面：名字在前，怎么读放括号里', () => {
    expect(agent('润色的做法见 {{skill:polish-transcript}}。')).toBe('润色的做法见 `polish-transcript`（用 `skills_read` 读）。');
    expect(agent('细节参见{{skill:video-chapters}}。')).toBe('细节参见`video-chapters`（用 `skills_read` 读）。');
    expect(agent('做法在 {{skill:talking-head-cut}} 里。')).toBe('做法在 `talking-head-cut`（用 `skills_read` 读） 里。');
    expect(agent('2. 按 {{skill:polish-transcript}} 润色，写回。')).toBe('2. 按 `polish-transcript`（用 `skills_read` 读） 润色，写回。');
    expect(agent('| 要总结 | {{skill:video-summary}} |')).toBe('| 要总结 | `video-summary`（用 `skills_read` 读） |');
    expect(agent('craft 的事：{{skill:video-blog}}、{{skill:video-summary}}。')).toBe(
      'craft 的事：`video-blog`（用 `skills_read` 读）、`video-summary`（用 `skills_read` 读）。',
    );
  });

  it('前面紧挨着「读」时不说两遍「读」；「通读」这类不算', () => {
    expect(agent('1. 读 {{skill:talking-head-cut}}。')).toBe('1. 用 `skills_read` 读 `talking-head-cut`。');
    expect(agent('动手前先读{{skill:shorts-segments}}。')).toBe('动手前先用 `skills_read` 读 `shorts-segments`。');
    expect(agent('通读 {{skill:video-blog}}。')).toBe('通读 `video-blog`（用 `skills_read` 读）。');
    // 别的占位符前面的「读」原样留下；CLI 面的「读」也留着。
    expect(agent('读 {{tool:documents_read}} 的结果')).toBe('读 `documents_read` 的结果');
    expect(cli('1. 读 {{skill:talking-head-cut}}。')).toBe('1. 读 [talking-head-cut](craft/talking-head-cut.md)。');
    expect(cli('读 {{tool:documents_read}} 的结果')).toBe('读 `baocut documents read` 的结果');
  });
});

describe('command craft links', () => {
  it.each([
    ['See {{skill:demo-polish}}.', 'See `demo-polish` (read with `baocut skills read demo-polish`).'],
    ['读 {{skill:demo-polish}}', 'use `baocut skills read demo-polish`'],
    ['动手前先读{{skill:shorts-segments}}。', '动手前先 use `baocut skills read shorts-segments`。'],
    ['1. 读 {{skill:demo-polish}}', '1. use `baocut skills read demo-polish`'],
  ])('uses English guidance while preserving the runnable command: %s', (source, expected) => {
    const result = renderAgentSkillText(source, {
      face: 'cli', file: 'references/workflows.md', craftLinks: 'command',
    });
    expect(result).toBe(expected);
  });
});

describe('只在会话里有的工具在 CLI 面的兜底写法', () => {
  const cli = (text: string) => renderAgentSkillText(text, { face: 'cli', file: 'references/craft/x.md', catalog: CLI });
  const agent = (text: string) => renderAgentSkillText(text, { face: 'agent', file: 'references/craft/x.md', catalog: AGENT });

  it('downloads_save 在终端里没有命令：常见的整句换成「把路径告诉用户」，其余地方换成兜底说法，都不提工具名', () => {
    // craft 里的原句（skills/translate-subtitles 等）。
    expect(cli('写成工作目录里的新文件，再用 downloads_save 放进下载目录，把它返回的 path 告诉用户。')).toBe(
      '写成工作目录里的新文件，再把文件的路径告诉用户（终端里没有下载目录这一步：文件就在你写的位置）。',
    );
    expect(cli('交付时用 `downloads_save` 把说明放进下载目录。')).toBe(
      '交付时把文件的路径告诉用户（终端里没有下载目录这一步：文件就在你写的位置）。',
    );
    // 说明书里写成占位符也一样（不按终端的目录核对、不报「目录里没有」）。
    expect(cli('最后 {{tool:downloads_save}}。')).toBe('最后 把文件交给用户（终端里直接告诉用户文件的路径）。');
    expect(renderSessionOnlyTools('看 downloads_saved 与 my_downloads_save')).toBe('看 downloads_saved 与 my_downloads_save');
    // 代码块里不动。
    expect(cli('```text\ndownloads_save\n```')).toBe('```text\ndownloads_save\n```');
    // 工具桥面原样。
    expect(agent('再用 {{tool:downloads_save}} 放进下载目录。')).toBe('再用 `downloads_save` 放进下载目录。');
  });

  it('slides_check 与 slides_import_asset：craft 里的那一步从「调用」起整行换掉，其余地方换成兜底说法', () => {
    // skills/slides 的第 6 步与第 4 步。
    expect(cli('6. **校验**。调用 `slides_check`（参数 `path` 是 deck 目录），逐条改掉它列出的问题。问题为 0 后线程里出现卡片。')).toBe(
      '6. **校验**。终端里没有校验命令：按 `references/format.md` 逐页自查标签、样式与图片地址，按 `references/design.md` 的估算确认放得下，' +
        '再核对 `deck.json` 的 `order`、`sections`、`cover` 都指向存在的页，`slides/` 里没有 `order` 之外的文件。',
    );
    expect(cli('4. **准备图片**。用户给的图片，逐张调用 `slides_import_asset` 放进 deck：返回的 `src` 写进 `<img src>`。')).toBe(
      '4. **准备图片**。用户给的图片，终端里没有把图片导入 deck 的命令：页面先不放图片，交付时说明哪几页该配什么图。',
    );
    expect(cli('最后跑一遍 {{tool:slides_check}}。')).toBe('最后跑一遍 幻灯片校验（只在 BaoCut 的会话里有）。');
    expect(cli('- 字体文件逐个用 `slides_import_asset` 导入，`src` 写它返回的 `/_blob/<id>`。')).toBe(
      `- 字体文件${SESSION_ONLY_TOOLS.slides_import_asset!.morePhrases![0]!.replacement}`,
    );
    expect(cli('图片经 slides_import_asset 放进来。')).toBe('图片经 导入图片与字体（只在 BaoCut 的会话里有） 放进来。');
    // 工具桥面原样。
    expect(agent('调用 {{tool:slides_check}} 校验。')).toBe('调用 `slides_check` 校验。');
  });

  it('design_check 与 design_import_asset：skills/design 的校验句与导入句整句换掉，其余地方换成兜底说法', () => {
    // skills/design「新建」的第 6 步与第 3 步。
    expect(
      cli(
        '6. 其余的。然后对设计稿运行 design_check，改掉它列出的每个问题，再运行一次，直到一个问题都不列：这时线程里才出现设计稿卡片。然后说一句。',
      ),
    ).toBe(
      '6. 其余的。终端里没有设计稿校验，也没有设计稿卡片：按 `references/format.md` 自己逐个检查文件' +
        '（标签都闭合、attribute 都加引号、`support.js` 那一行头部原样、`boards` 与 `order` 都指向存在的文件）。然后说一句。',
    );
    expect(
      cli(
        '3. 每个字体**文件**：用 design_import_asset 导入（见下文；先写好 `canvas.json`，见第 5 步）→ 它返回的 `src` **原样**写到 `<img src>` 或 `@font-face`。.css 文件照旧。',
      ),
    ).toBe('3. 每个字体**文件**：终端里没有把它导入设计稿的命令：先不放（图片换成带说明的 placeholder），并说明这份设计需要哪些文件。.css 文件照旧。');
    expect(cli('4. 然后 design_check，直到不列问题。')).toBe('4. 然后 设计稿校验（只在 BaoCut 的会话里有），直到不列问题。');
    expect(cli('导入（design_import_asset）只用于字体')).toBe('导入（导入素材（只在 BaoCut 的会话里有））只用于字体');
    // 工具桥面原样。
    expect(agent('然后 {{tool:design_check}}。')).toBe('然后 `design_check`。');
  });

  it('design_system_check 与 design_system_import_asset：skills/design-system 的校验句与两条调用说明整句换掉', () => {
    expect(
      cli('3. index **最后**写。然后对设计系统运行 design_system_check，改掉它列出的每个问题，再运行一次，直到一个问题都不列：这时线程里才出现设计系统卡片。'),
    ).toBe(
      '3. index **最后**写。终端里没有设计系统校验，也没有设计系统卡片：按 `references/format.md` 自己逐个检查文件' +
        '（index 的 marker 与字段、`tokens.json` 里每个 family 都写成列表、每条 record 与每个 `/_blob/<id>` 都指向存在的文件）。',
    );
    expect(
      cli('- design_system_check（`path` = 设计系统的目录）→ 按文件列出的问题，以及不需要改动的提示；没有问题时：线程里出现设计系统卡片。'),
    ).toBe(
      '- 终端里没有设计系统校验，也没有设计系统卡片：按 `references/format.md` 自己逐个检查文件' +
        '（index 的 marker 与字段、`tokens.json` 里每个 family 都写成列表、每条 record 与每个 `/_blob/<id>` 都指向存在的文件）。',
    );
    expect(
      cli(
        '- design_system_import_asset（`system` = 设计系统的目录，`path` = 工作目录里的文件，`group` = 它所在的素材组）→ `src`（`/_blob/<id>`），以及要写到 index 里 `indexPath` 处的 `record`。还没有 index 的目录也能上传：index 照样最后写。',
      ),
    ).toBe(`- ${SESSION_ONLY_TOOLS.design_system_import_asset!.replacement}`);
    expect(cli('图片经 design_system_import_asset 上传。')).toBe('图片经 上传素材（只在 BaoCut 的会话里有） 上传。');
    expect(agent('然后 {{tool:design_system_check}}。')).toBe('然后 `design_system_check`。');
  });
});

describe('说明书的标记法报错', () => {
  const render = (text: string, face: 'cli' | 'agent' = 'cli') => renderAgentSkillText(text, { face, file: 'references/x.md' });
  const errorOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(AgentSkillRenderError);
      return (error as Error).message;
    }
    throw new Error('应当抛错');
  };

  it('未知占位符、未闭合的占位符带文件与行号', () => {
    expect(errorOf(() => render('一\n二 {{tool:Bad Name}}'))).toBe('references/x.md:2：工具名不合规：{{tool:Bad Name}}');
    expect(errorOf(() => render('{{thing:x}}'))).toContain('references/x.md:1：不认识的占位符 {{thing:x}}');
    expect(errorOf(() => render('甲\n乙\n{{tool:documents_read'))).toBe('references/x.md:3：占位符没有闭合（有 {{ 没有对应的 }}）');
    // 代码里不带 kind: 的是模板洞（skills/design 讲 Design Component 的写法），原样保留；正文里的、带了不认识 kind: 的照样报错。
    expect(render('洞写成 `{{ item.x }}`，属性 `x="{{hole}}"`；{{tool:documents_read}}')).toBe(
      '洞写成 `{{ item.x }}`，属性 `x="{{hole}}"`；`baocut documents read`',
    );
    expect(render('```html\n<h1>{{title}}</h1>\n<p>{{ }}</p>\n```')).toBe('```html\n<h1>{{title}}</h1>\n<p>{{ }}</p>\n```');
    expect(errorOf(() => render('标题 {{title}}'))).toContain('references/x.md:1：不认识的占位符 {{title}}');
    expect(errorOf(() => render('`{{thing:x}}`'))).toContain('不认识的占位符 {{thing:x}}');
    expect(errorOf(() => render('`{{hole}}` 与 `{{hole`'))).toContain('占位符没有闭合');
    expect(errorOf(() => renderAgentSkillText('{{tool:nope_nope}}', { face: 'cli', file: 'a.md', catalog: CLI }))).toContain(
      'a.md:1：{{tool:nope_nope}}：CLI 面的目录里没有这个工具',
    );
    expect(errorOf(() => renderAgentSkillText('{{skill:none}}', { face: 'cli', file: 'a.md', craftIds: new Set(['x']) }))).toContain(
      'a.md:1',
    );
  });

  it('surface 与生成块：未闭合、嵌套、交叉、多余的闭合、不认识的名字', () => {
    expect(errorOf(() => render('a\n<!-- surface: cli -->\nb'))).toBe('references/x.md:2：surface 标记没有闭合');
    expect(errorOf(() => render('<!-- surface: cli -->\n<!-- surface: agent -->'))).toContain('references/x.md:2：surface 标记不能嵌套');
    expect(errorOf(() => render('<!-- surface: web -->'))).toContain('不认识的面「web」');
    expect(errorOf(() => render('<!-- /surface -->'))).toContain('references/x.md:1：多出来的');
    expect(errorOf(() => render('<!-- generated: common-ops -->\n'))).toBe('references/x.md:1：生成块没有闭合');
    expect(errorOf(() => render('<!-- generated: misc -->\n<!-- /generated -->'))).toContain('不认识的生成块「misc」');
    expect(errorOf(() => render('<!-- surface: cli -->\n<!-- generated: tool-map -->\n<!-- /surface -->\n<!-- /generated -->'))).toContain(
      'references/x.md:3',
    );
  });

  it('链接到说明书里没有的页时报错；行内代码里的链接与占位符不动', () => {
    const files = new Set(['SKILL.md', 'references/x.md']);
    expect(errorOf(() => renderAgentSkillText('见 [y](y.md)', { face: 'cli', file: 'references/x.md', files }))).toContain(
      'references/x.md:1：链接 [y](y.md) 指向的 references/y.md 不在说明书里',
    );
    expect(renderAgentSkillText('写 `[a](b.md)` 与 `{{tool:documents_read}}`', { face: 'agent', file: 'SKILL.md', files })).toBe(
      '写 `[a](b.md)` 与 `documents_read`',
    );
  });
});

describe('说明书的位置', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('环境变量优先，其次是打包资源，最后是仓库根', () => {
    expect(resolveBuiltinAgentSkillsDir({ BAOCUT_AGENT_SKILLS_DIR: '/x/skills' })).toBe('/x/skills');
    const resources = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-agent-skills-'));
    dirs.push(resources);
    fs.mkdirSync(path.join(resources, 'skills'));
    expect(resolveBuiltinAgentSkillsDir({}, [resources])).toBe(path.join(resources, 'skills'));
    expect(resolveBuiltinAgentSkillsDir({}, [path.join(resources, 'missing')])).toBe(findRepoDir('skills'));
  });
});

describe('仓库里的说明书', () => {
  const dir = path.join(findRepoDir('skills')!, 'baocut');

  // §8.6 的三条测试，对仓库里真实的说明书与真实的工具目录（Runtime 的工具组，按面取视图）。
  const source = readAgentSkillDir(dir);
  const cli = renderAgentSkill(source, { face: 'cli', catalog: CLI });
  const agent = renderAgentSkill(source, { face: 'agent', catalog: AGENT });
  const guidance = renderAgentGuidance(source, AGENT);

  it('CLI 面的渲染里没有 a_b 工具名与工具桥用语', () => {
    expect(bridgeNamesInCliFace(cli)).toEqual([]);
  });

  it('内置 skill 的 front matter 与说明书的路由表不写 a_b 工具名（它们原样进索引与引言，不经工具名改写）', () => {
    const bare = (text: string) =>
      CLI_COMPOUND.filter((name) => new RegExp(`(?<![A-Za-z0-9_{:])${name}(?![A-Za-z0-9_])`).test(text.replace(/\{\{[^}]*\}\}/g, '')));
    const skillsDir = resolveBuiltinSkillsDir({})!;
    const hits: string[] = [];
    for (const id of fs.readdirSync(skillsDir)) {
      const file = path.join(skillsDir, id, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      const parsed = parseSkillFrontmatter(fs.readFileSync(file, 'utf8'));
      expect(parsed.ok, id).toBe(true);
      if (!parsed.ok) continue;
      for (const [key, value] of parsed.fields) for (const name of bare(value)) hits.push(`${id} ${key}: ${name}`);
    }
    const skill = source.get('SKILL.md')!;
    const table = skill.slice(skill.indexOf('| 用户说的话 |'), skill.indexOf('### 三条底线'));
    expect(table.length).toBeGreaterThan(0);
    for (const name of bare(table)) hits.push(`SKILL.md 路由表: ${name}`);
    expect(hits).toEqual([]);
  });

  it('工具桥面的渲染里没有 baocut 命令、--yes 与退出码（含会话指导与内置页面）', () => {
    expect(cliTracesInAgentFace(agent)).toEqual([]);
    const rendered: AgentSkillFiles = new Map([
      ['guidance', guidance.guidance],
      ...guidance.pages.map((page) => [page.id, page.body] as const),
    ]);
    expect(cliTracesInAgentFace(rendered)).toEqual([]);
  });

  it('两面渲染出的硬规则条数相同', () => {
    expect(countHardRules(cli.get('SKILL.md')!)).toBe(11);
    expect(countHardRules(agent.get('SKILL.md')!)).toBe(11);
    expect(countHardRules(guidance.guidance)).toBe(11);
  });

  it('工具桥面：目录页、做法总览与约定成为内置页面，名字与说明取 front matter 或标题', () => {
    expect(guidance.pages.map((page) => page.id)).toEqual([
      'baocut-catalog-editing',
      'baocut-catalog-export',
      'baocut-catalog-media',
      'baocut-catalog-models',
      'baocut-catalog-music',
      'baocut-catalog-subtitles',
      'baocut-catalog-system',
      'baocut-catalog-voice-gemini-tts',
      'baocut-catalog-voice-language-rates',
      'baocut-catalog-voice',
      'baocut-workflows',
      'baocut-conventions',
    ]);
    for (const page of guidance.pages) {
      expect(page.name, page.id).not.toBe(page.id);
      expect(page.description, page.id).toMatch(/^[^-#|<]/);
      expect([...page.description].length, page.id).toBeLessThanOrEqual(300);
      expect(page.body, page.id).not.toMatch(/<!--|\{\{|^---/);
    }
    // 指导里引用的页面 id 都在。
    const ids = new Set(guidance.pages.map((page) => page.id));
    for (const match of guidance.guidance.matchAll(/`(baocut-[a-z-]+)`/g)) expect(ids.has(match[1]!), match[1]).toBe(true);
  });
});
