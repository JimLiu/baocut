#!/usr/bin/env node
/**
 * 说明书的同步（Agent 面设计 §8.3、§8.6、§8.7）：
 *
 * 1. craft 副本：每个内置 skill `skills/<id>/`（SKILL.md + references/*.md）合成一页 `agent-skills/baocut/references/craft/<id>.md`。
 *    front matter 去掉，正文开头的一级标题作标题（没有时用 `name`）、`description` 作引言，references 作二级附录；工具桥的工具名按 CLI 面改写
 *    （`documents_read` → `baocut documents read`，`edits_apply` 的操作名不动），`skills_read` 的说法改成读本页附录或别的
 *    craft 页；正文里的标记与占位符按 CLI 面渲染（与说明书同一个渲染器）。`skills/` 里没有了的 craft 页删掉。
 * 2. 生成块：说明书里 `<!-- generated: <名字> -->` … `<!-- /generated -->` 之间的内容按目录重写：
 *    `common-ops`（最常用的 8 个 `edits_apply` 操作，来自 `edits_ops` 的说明与示例）、`error-codes`（错误码 → 退出码 →
 *    下一步，来自 `apps/cli/src/envelope.ts` 的表）、`tool-map`（MCP 工具 ↔ CLI 命令 ↔ 效果，来自目录）。
 * 3. 写完按两个面各渲染一遍（CLI 面核对终端的目录，工具桥面核对会话内智能体的目录），占位符或标记有错就失败。
 *
 *   node tools/sync-agent-skill.ts                 写入
 *   node tools/sync-agent-skill.ts --check         与磁盘不一致（或渲染不过）时退出码 1
 *   node tools/sync-agent-skill.ts --root <目录>   换一个根（下面有 skills/ 与 agent-skills/baocut/，测试的夹具用它）
 *
 * 根 `package.json` 的 `build:agent-skill` 跑它。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolCommandName, type CatalogEditOperations, type CatalogTool } from '@baocut/protocol';
import { silentLogger } from '@baocut/harness';
import { EXIT_BY_CODE } from '../apps/cli/src/envelope.ts';
import { ToolCatalog } from '../packages/runtime-core/src/agent-tools/tool-catalog.ts';
import { allToolSets } from '../packages/runtime-core/src/agent-tools/all-tool-sets.ts';
import {
  AGENT_SKILL_CRAFT_DIR,
  AGENT_SKILL_ID,
  AgentSkillRenderError,
  craftIdsOf,
  readAgentSkillDir,
  renderAgentSkill,
  renderAgentSkillText,
  type AgentSkillFace,
  type AgentSkillGeneratedBlock,
} from '../packages/runtime-core/src/skills/agent-skill-renderer.ts';
import { parseSkillFrontmatter } from '../packages/runtime-core/src/skills/skill-frontmatter.ts';
import { buildCatalogSnapshot } from './catalog-snapshot.ts';

export const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 生成要用的目录与表。默认从当前代码取；测试可以换。 */
export interface SyncInputs {
  /** 终端的目录（`surfaces` 含 `cli`）。 */
  cliTools: readonly CatalogTool[];
  /** 会话内智能体（工具桥）看到的工具名。 */
  agentToolNames: readonly string[];
  editOps: CatalogEditOperations;
  /** 错误码 → 退出码（没列出的是 1）。 */
  exitCodes: Readonly<Record<string, number>>;
}

export function defaultSyncInputs(): SyncInputs {
  const snapshot = buildCatalogSnapshot();
  const agent = new ToolCatalog(allToolSets(), silentLogger, { surface: 'agent' });
  return {
    cliTools: snapshot.tools,
    agentToolNames: agent.list().map((tool) => tool.name),
    editOps: snapshot.editOps,
    exitCodes: EXIT_BY_CODE,
  };
}

export interface SyncResult {
  /** 相对 `root` 的路径 → 应有的内容（craft 页与带生成块的页）。 */
  files: Map<string, string>;
  /** 该删的 craft 页（相对 `root`）。 */
  stale: string[];
  /** 不阻止同步、但要人看的问题（例如 craft 里只在工具桥里有的工具名）。 */
  warnings: string[];
}

/** 算出同步后应有的文件，不写盘。 */
export function buildAgentSkillSync(root: string, inputs: SyncInputs = defaultSyncInputs()): SyncResult {
  const skillsDir = path.join(root, 'skills');
  const agentRel = `agent-skills/${AGENT_SKILL_ID}`;
  const agentDir = path.join(root, agentRel);
  if (!isDirectory(agentDir)) throw new Error(`没有说明书目录 ${agentDir}`);
  const files = new Map<string, string>();
  const warnings: string[] = [];

  // 1. craft 副本。
  const craftIds = isDirectory(skillsDir)
    ? fs
        .readdirSync(skillsDir, { withFileTypes: true })
        .filter(
          (entry) => entry.isDirectory() && !entry.name.startsWith('.') && fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md')),
        )
        .map((entry) => entry.name)
        .sort()
    : [];
  const ids = new Set(craftIds);
  for (const id of craftIds) {
    files.set(`${agentRel}/${AGENT_SKILL_CRAFT_DIR}/${id}.md`, composeCraft(id, path.join(skillsDir, id), ids, inputs, warnings));
  }
  const craftAbs = path.join(agentDir, AGENT_SKILL_CRAFT_DIR);
  const stale = isDirectory(craftAbs)
    ? fs
        .readdirSync(craftAbs)
        // 只管 `<id>.md`；README.md 这类说明文件不归同步脚本。
        .filter((name) => craftIdsOf([`${AGENT_SKILL_CRAFT_DIR}/${name}`]) !== null && !ids.has(name.slice(0, -'.md'.length)))
        .map((name) => `${agentRel}/${AGENT_SKILL_CRAFT_DIR}/${name}`)
    : [];

  // 2. 生成块。
  const source = readAgentSkillDir(agentDir);
  for (const [rel, text] of source) {
    if (!rel.endsWith('.md') || rel.startsWith(`${AGENT_SKILL_CRAFT_DIR}/`)) continue;
    const filled = fillGeneratedBlocks(text, rel, inputs);
    if (filled !== null) files.set(`${agentRel}/${rel}`, filled);
  }

  // 3. 两个面各渲染一遍：占位符、标记与工具名都要过。
  const merged = new Map(source);
  for (const id of craftIdsOf(merged) ?? []) merged.delete(`${AGENT_SKILL_CRAFT_DIR}/${id}.md`);
  for (const [rel, text] of files) merged.set(rel.slice(agentRel.length + 1), text);
  renderAgentSkill(merged, { face: 'cli', catalog: { tools: inputs.cliTools } });
  renderAgentSkill(merged, { face: 'agent', catalog: { tools: inputs.agentToolNames.map((name) => ({ name })) } });

  return { files, stale, warnings };
}

// ---- craft ----

/** 一份 craft 合成一页。 */
export function composeCraft(id: string, dir: string, craftIds: ReadonlySet<string>, inputs: SyncInputs, warnings: string[]): string {
  const sourceRel = `skills/${id}`;
  const skillSource = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  const parsed = parseSkillFrontmatter(skillSource);
  if (!parsed.ok) throw new Error(`${sourceRel}/SKILL.md：${parsed.problem}`);
  // 标题取正文开头的一级标题（`name` 是 skill 的 id，给人看的名字写在正文第一行），没有时退回 `name`。
  const title = firstHeading(parsed.body) ?? (parsed.fields.get('name') || id);
  const description = parsed.fields.get('description') ?? '';

  const refsDir = path.join(dir, 'references');
  const refFiles = isDirectory(refsDir) ? listMarkdown(refsDir).map((file) => `references/${file}`) : [];
  const appendices = refFiles.map((file) => {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    return { file, title: firstHeading(text) ?? path.posix.basename(file, '.md'), text };
  });
  const titles = new Map(appendices.map((a) => [a.file, a.title]));

  const page = `${AGENT_SKILL_CRAFT_DIR}/${id}.md`;
  // 正文是源文件的尾部（去掉了 front matter 与开头的标题）：报错与提醒的行号按源文件算。
  const rewrite = (text: string, file: string, source: string) => {
    const lineOffset = source.replace(/\r\n?/g, '\n').split('\n').length - text.split('\n').length;
    return rewriteCraftText(text, { id, file: `${sourceRel}/${file}`, lineOffset, page, titles, craftIds, inputs, warnings });
  };

  const out: string[] = [
    `<!-- 由 tools/sync-agent-skill.ts 从 ${sourceRel}/ 生成，不要手改：改源文件后运行 npm run build:agent-skill -->`,
    '',
    `# ${title}`,
    '',
  ];
  if (description) out.push(`> ${description.replace(/\s*\n\s*/g, ' ')}`, '');
  out.push(rewrite(dropLeadingHeading(parsed.body), 'SKILL.md', skillSource).trim(), '');
  for (const appendix of appendices) {
    out.push(`## 附录：${appendix.title}`, '');
    out.push(demoteHeadings(rewrite(dropLeadingHeading(appendix.text), appendix.file, appendix.text)).trim(), '');
  }
  return out.join('\n');
}

interface RewriteContext {
  id: string;
  /** 源文件（报错用）：`skills/<id>/SKILL.md`。 */
  file: string;
  /** 正文第一行在源文件里的行号减一。 */
  lineOffset: number;
  /** 副本在说明书里的位置：`references/craft/<id>.md`。 */
  page: string;
  /** 本 skill 的 references 文件 → 附录标题。 */
  titles: ReadonlyMap<string, string>;
  craftIds: ReadonlySet<string>;
  inputs: SyncInputs;
  warnings: string[];
}

/**
 * craft 正文按 CLI 面改写。`skills_read` 的说法只认下面几种写法，其余的报错（带文件与行号），由写 craft 的人改成能对上的说法，
 * 不猜：
 *
 * - 「用 `skills_read` 读本 skill 的 `references/x.md`」→「读本页的附录「…」」；
 * - 「…，要做这些时用 `skills_read` 取」→「…，要做这些时翻到那一节读」；
 * - 「用 `skills_read` 读 `<别的 craft id>`」→ 指向那一页的链接。
 * - 「用 `skills_read` 读 `baocut-catalog-<页>`」→ 指向共享目录页的链接，不复制正文；目标在整份说明书渲染时校验。
 */
export function rewriteCraftText(text: string, ctx: RewriteContext): string {
  const cliNames = ctx.inputs.cliTools.map((tool) => tool.name);
  const lineAt = (index: number) => ctx.lineOffset + index + 1;
  let out: string;
  try {
    out = renderAgentSkillText(text, { face: 'cli', file: ctx.page, catalog: { tools: ctx.inputs.cliTools }, craftIds: ctx.craftIds });
  } catch (error) {
    if (!(error instanceof AgentSkillRenderError)) throw error;
    throw new AgentSkillRenderError(ctx.file, error.line > 0 ? lineAt(error.line - 1) : 0, error.problem);
  }
  // 以下的改写都不增删行，第 i 行仍对应正文的第 i 行。
  const lines = out.split('\n').map((line, index) =>
    line
      .replace(/`(references\/[^`\s]+\.md)`/g, (whole, ref: string) => {
        const title = ctx.titles.get(ref);
        if (title) return `附录「${title}」`;
        ctx.warnings.push(`${ctx.file}:${lineAt(index)}：提到的 ${ref} 不在这个 skill 的 references/ 里，原样留下`);
        return whole;
      })
      .replace(/用\s*`skills_read`\s*读本 skill 的\s*/g, '读本页的')
      .replace(/用\s*`skills_read`\s*取/g, '翻到那一节读')
      .replace(/用\s*`skills_read`\s*读\s*`([a-z0-9-]+)`/g, (whole, other: string) => {
        const catalogPage = /^baocut-catalog-([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(other);
        if (catalogPage) {
          const target = `references/catalog/${catalogPage[1]}.md`;
          return `读 [${other}](${path.posix.relative(path.posix.dirname(ctx.page), target)})`;
        }
        if (!ctx.craftIds.has(other)) return whole;
        return `读 [\`${AGENT_SKILL_CRAFT_DIR}/${other}.md\`](${other}.md)`;
      }),
  );
  const left = lines.findIndex((line) => line.includes('skills_read'));
  if (left >= 0) {
    throw new AgentSkillRenderError(
      ctx.file,
      lineAt(left),
      '这种 `skills_read` 的说法没法改写成 CLI 面：写成「用 `skills_read` 读本 skill 的 `references/…`」或「用 `skills_read` 读 `<craft id>`」',
    );
  }
  out = renderCraftToolNames(lines.join('\n'), cliNames);
  const bridgeOnly = ctx.inputs.agentToolNames.filter((name) => !cliNames.includes(name));
  out.split('\n').forEach((line, index) => {
    for (const name of bridgeOnly) {
      if (craftToolNamePattern([name])!.test(line)) {
        ctx.warnings.push(`${ctx.file}:${lineAt(index)}：${name} 只在 BaoCut 的会话里有，CLI 面没有对应的命令，原样留下`);
      }
    }
  });
  return out;
}

/**
 * 正文里的裸工具名换成 CLI 命令（名字规则同 `renderCliToolNames`）；不在行内代码或代码块里时套上反引号，与占位符的输出一致。
 * 一级动词（`speak`、`export`）也改，所以边界比 `renderCliToolNames` 严：带 `-`、`/`、`.` 的不算（`translate-subtitles.md`、`export/`），
 * 后面跟 `:` 的是字段不是工具（`download` 的 `transcribe: true`）。
 */
const CRAFT_TOOL_NAME_BOUNDARY = { before: '(?<![A-Za-z0-9_\\-/.])', after: '(?![A-Za-z0-9_\\-/.]|\\s*:)' } as const;

function craftToolNamePattern(names: readonly string[], flags = ''): RegExp | null {
  const sorted = [...names].sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return null;
  return new RegExp(`${CRAFT_TOOL_NAME_BOUNDARY.before}(${sorted.join('|')})${CRAFT_TOOL_NAME_BOUNDARY.after}`, flags);
}

function renderCraftToolNames(text: string, names: readonly string[]): string {
  const pattern = craftToolNamePattern(names, 'g');
  if (!pattern) return text;
  let fence: string | null = null;
  return text
    .split('\n')
    .map((line) => {
      const mark = /^\s*(```|~~~)/.exec(line)?.[1];
      if (mark && (!fence || fence === mark)) {
        fence = fence ? null : mark;
        return line;
      }
      return line.replace(pattern, (name: string, _g: string, offset: number) => {
        const command = `baocut ${toolCommandName(name).display}`;
        if (fence) return command;
        const ticks = [...line.slice(0, offset)].filter((c) => c === '`').length;
        return ticks % 2 === 1 ? command : `\`${command}\``;
      });
    })
    .join('\n');
}

function listMarkdown(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listMarkdown(dir, child));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(child);
  }
  return out;
}

function firstHeading(text: string): string | null {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  return /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? null;
}

/** 去掉开头的一级标题（页首已经用它作了标题）。 */
function dropLeadingHeading(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first >= 0 && /^#\s/.test(lines[first]!)) lines.splice(0, first + 1);
  return lines.join('\n');
}

/** 标题降一级（代码块里的不动）：附录里的 `##` 变 `###`。 */
function demoteHeadings(text: string): string {
  let fence = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      if (fence) return line;
      return /^#{1,5}\s/.test(line) ? `#${line}` : line;
    })
    .join('\n');
}

// ---- 生成块 ----

const SURFACE_OPEN = /^\s*<!--\s*surface:\s*(\S+?)\s*-->\s*$/;
const SURFACE_CLOSE = /^\s*<!--\s*\/surface\s*-->\s*$/;
const GENERATED_OPEN = /^\s*<!--\s*generated:\s*(\S+?)\s*-->\s*$/;
const GENERATED_CLOSE = /^\s*<!--\s*\/generated\s*-->\s*$/;

/** 重写一页里的生成块；没有生成块时 null。标记的合法性由渲染器检查，这里只认出块与它所在的面。 */
export function fillGeneratedBlocks(text: string, file: string, inputs: SyncInputs): string | null {
  const lines = text.split('\n');
  const out: string[] = [];
  let surface: AgentSkillFace | null = null;
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const open = SURFACE_OPEN.exec(line);
    if (open) surface = open[1] as AgentSkillFace;
    else if (SURFACE_CLOSE.test(line)) surface = null;
    out.push(line);
    const generated = GENERATED_OPEN.exec(line);
    if (!generated) continue;
    found = true;
    const end = lines.findIndex((candidate, j) => j > i && GENERATED_CLOSE.test(candidate));
    if (end < 0) throw new AgentSkillRenderError(file, i + 1, '生成块没有闭合');
    const name = generated[1] as AgentSkillGeneratedBlock;
    out.push(...generateBlock(name, surface, inputs, file, i + 1).split('\n'));
    out.push(lines[end]!);
    i = end;
  }
  return found ? out.join('\n') : null;
}

function generateBlock(
  name: AgentSkillGeneratedBlock,
  surface: AgentSkillFace | null,
  inputs: SyncInputs,
  file: string,
  line: number,
): string {
  switch (name) {
    case 'common-ops':
      return commonOps(inputs.editOps);
    case 'error-codes':
      if (surface) return errorCodes(surface, inputs.exitCodes);
      return wrapFaces(errorCodes('cli', inputs.exitCodes), errorCodes('agent', inputs.exitCodes));
    case 'tool-map':
      if (surface === 'agent') throw new AgentSkillRenderError(file, line, 'tool-map 只属于 CLI 面，不能放在 agent 段里');
      return surface === 'cli' ? toolMap(inputs.cliTools) : wrapFaces(toolMap(inputs.cliTools), null);
    default:
      throw new AgentSkillRenderError(file, line, `不认识的生成块「${name as string}」`);
  }
}

function wrapFaces(cli: string, agent: string | null): string {
  const parts = ['<!-- surface: cli -->', cli, '<!-- /surface -->'];
  if (agent !== null) parts.push('<!-- surface: agent -->', agent, '<!-- /surface -->');
  return parts.join('\n');
}

/** `common-ops` 选的操作与给人看的叫法（§8.7：放素材、裁剪、挪动、删除、分割、调音量、改文字优先）。 */
export const COMMON_OPS: readonly { op: string; label: string }[] = [
  { op: 'importAsset', label: '导入素材' },
  { op: 'addItem', label: '放素材' },
  { op: 'trimItem', label: '裁剪' },
  { op: 'moveItem', label: '挪动' },
  { op: 'deleteItems', label: '删除' },
  { op: 'splitItem', label: '分割' },
  { op: 'setAudioMix', label: '调音量' },
  { op: 'setText', label: '改文字' },
];

function commonOps(editOps: CatalogEditOperations): string {
  const byType = new Map(editOps.families.flatMap((family) => family.operations.map((op) => [op.type, op] as const)));
  const out: string[] = [];
  for (const { op, label } of COMMON_OPS) {
    const entry = byType.get(op);
    if (!entry) throw new Error(`common-ops：edits_ops 里没有操作 ${op}`);
    out.push(`**${label}**（\`${op}\`）：${firstSentence(entry.description)}`, '', '```json', JSON.stringify(entry.example), '```', '');
  }
  out.push(
    '字幕层用 {{tool:captions_create}} 建，不是这里的操作；剪掉一段并让后面前移用 `removeRange`，口播的剪口用 `addCuts`。' +
      '其余操作与每个字段的写法用 {{tool:edits_ops}} 取。',
  );
  return out.join('\n');
}

/** 操作说明的第一句：签名之后（第一个「：」之后）到第一个句号。 */
function firstSentence(description: string): string {
  const colon = description.indexOf('：');
  const rest = colon >= 0 ? description.slice(colon + 1) : description;
  const end = rest.indexOf('。');
  return (end >= 0 ? rest.slice(0, end + 1) : rest).trim();
}

/** 退出码的「下一步」（命令与协议规范 §11.7 各档的含义）。 */
const CLI_NEXT: Readonly<Record<number, string>> = {
  2: '要用户先做一件事：配置能力、授权或预算、同意或安装外部工具、登录、音色授权。把 `remedy` 原样转告用户，用户做完后照 `next` 重试；不用脚本、别的服务商或手改配置绕过',
  3: 'Runtime 不可用或版本不同。先 `baocut runtime ensure`；接口版本不同时请用户更新 BaoCut 或 CLI，不绕过',
  4: '参数不对：对照 `baocut help <命令>` 或 `baocut spec <名字>` 改；缺 `--yes` 时先问用户，用户同意后再加',
};
const RUNTIME_NOT_MINE = 'Runtime 不归这个 CLI 停，或还有人在用：不停它，留着';
const AGENT_SKILL_BROKEN =
  '说明书装不了：BaoCut 安装不完整或说明书写错了。把 `message` 原样告诉用户，请用户重装或更新 BaoCut；不自己拼装说明书';
/** 退出码 1 里单独登记的错误码各有各的下一步：按错误码给，同一句的并成一行；没写到的落到「其他错误码」那一行的说法。 */
const CLI_NEXT_FAILED: Readonly<Record<string, string>> = {
  RUNTIME_NOT_OWNED: RUNTIME_NOT_MINE,
  RUNTIME_IN_USE: RUNTIME_NOT_MINE,
  AGENT_SKILL_NOT_FOUND: AGENT_SKILL_BROKEN,
  AGENT_SKILL_INVALID: AGENT_SKILL_BROKEN,
};
const CLI_OTHER =
  '失败或取消。看 `retryability`：`after-refresh` 先重新读再提交（版本冲突 `PROJECT_REVISION_CONFLICT` 时重新 {{tool:videos_inspect}}）；' +
  '`after-user-action` 转告用户；`never` 换做法。等待超时（`WAIT_TIMEOUT`）时任务还在跑，用 {{tool:jobs_wait}} 接着等';
const AGENT_NEXT_ACTION =
  '要用户先做一件事：配置能力、授权或预算、同意或安装外部工具、登录、音色授权。把 `remedy` 原样转告用户，用户做完后照 `next` 重试；不绕过';
const AGENT_NEXT_ARGS = '参数或工具名不对：对照工具的 schema 改；`edits_apply` 的操作字段用 {{tool:edits_ops}} 取';
const AGENT_OTHER =
  '失败或取消。看 `retryability`：`after-refresh` 先重新读再提交（版本冲突 `PROJECT_REVISION_CONFLICT` 时重新 {{tool:videos_inspect}}）；' +
  '`after-user-action` 转告用户；`never` 换做法';

function errorCodes(face: AgentSkillFace, exitCodes: Readonly<Record<string, number>>): string {
  const byExit = new Map<number, string[]>();
  for (const [code, exit] of Object.entries(exitCodes)) {
    if (!byExit.has(exit)) byExit.set(exit, []);
    byExit.get(exit)!.push(code);
  }
  const codes = (list: readonly string[]) => list.map((code) => `\`${code}\``).join(' ');
  if (face === 'cli') {
    const rows = ['| 错误码 | 退出码 | 下一步 |', '| --- | --- | --- |'];
    for (const exit of [2, 3, 4]) {
      const list = byExit.get(exit);
      if (list?.length) rows.push(`| ${codes(list)} | ${exit} | ${CLI_NEXT[exit] ?? ''} |`);
    }
    const failed = new Map<string, string[]>();
    for (const code of byExit.get(1) ?? []) {
      const next = CLI_NEXT_FAILED[code] ?? CLI_OTHER;
      if (!failed.has(next)) failed.set(next, []);
      failed.get(next)!.push(code);
    }
    for (const [next, list] of failed) rows.push(`| ${codes(list)} | 1 | ${next} |`);
    rows.push(`| 其他错误码 | 1 | ${CLI_OTHER} |`);
    return rows.join('\n');
  }
  // 工具桥面：只列会话内智能体会遇到的（要用户做事的、参数的），不带退出码。
  const rows = ['| 错误码 | 下一步 |', '| --- | --- |'];
  const action = byExit.get(2) ?? [];
  if (action.length) rows.push(`| ${codes(action)} | ${AGENT_NEXT_ACTION} |`);
  const args = Object.keys(exitCodes).filter((code) => code === 'INVALID_ARGUMENTS' || code === 'UNKNOWN_TOOL');
  if (args.length) rows.push(`| ${codes(args)} | ${AGENT_NEXT_ARGS} |`);
  rows.push(`| 其他错误码 | ${AGENT_OTHER} |`);
  return rows.join('\n');
}

function toolMap(tools: readonly CatalogTool[]): string {
  const rows = ['| MCP 工具 | CLI 命令 | 效果 |', '| --- | --- | --- |'];
  const cliOnly: string[] = [];
  for (const tool of [...tools].sort((a, b) => a.name.localeCompare(b.name))) {
    const command = `baocut ${toolCommandName(tool.name).display}`;
    if (tool.surfaces.includes('mcp')) rows.push(`| \`${tool.name}\` | \`${command}\` | ${tool.effect} |`);
    else cliOnly.push(`\`${command}\``);
  }
  if (cliOnly.length) rows.push('', `只在 CLI 里、MCP 上没有的：${cliOnly.join('、')}。`);
  return rows.join('\n');
}

// ---- 写盘与检查 ----

/** 与磁盘比较：不一致的文件（相对 `root`）。 */
export function diffAgentSkillSync(root: string, result: SyncResult): string[] {
  const changed = [...result.files].filter(([rel, text]) => readOrNull(path.join(root, rel)) !== text).map(([rel]) => rel);
  return [...changed, ...result.stale].sort();
}

export function writeAgentSkillSync(root: string, result: SyncResult): string[] {
  const changed = diffAgentSkillSync(root, result);
  for (const rel of changed) {
    const abs = path.join(root, rel);
    const text = result.files.get(rel);
    if (text === undefined) fs.rmSync(abs, { force: true });
    else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text);
    }
  }
  return changed;
}

function readOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root = rootIndex >= 0 && args[rootIndex + 1] ? path.resolve(args[rootIndex + 1]!) : REPO_ROOT;
  let result: SyncResult;
  try {
    result = buildAgentSkillSync(root);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  for (const warning of result.warnings) process.stderr.write(`注意：${warning}\n`);
  if (args.includes('--check')) {
    const changed = diffAgentSkillSync(root, result);
    if (changed.length) {
      process.stderr.write(`说明书与来源不一致：运行 npm run build:agent-skill\n${changed.map((rel) => `  ${rel}`).join('\n')}\n`);
      process.exit(1);
    }
  } else {
    for (const rel of writeAgentSkillSync(root, result)) process.stdout.write(`${result.files.has(rel) ? '写入' : '删除'} ${rel}\n`);
  }
}
