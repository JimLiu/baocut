import fs from 'node:fs';
import path from 'node:path';
import { fieldFlagName, toolCommandName, type Localized } from '@baocut/protocol';
import { RcAgentTools, RcSkills } from '@baocut/protocol/messages/runtime-core';
import { findRepoDir } from './skill-catalog.ts';
import { parseSkillFrontmatter } from './skill-frontmatter.ts';

/**
 * 说明书的渲染器（Agent 面设计 §8.6）：`agent-skills/baocut/`（SKILL.md + references/**）一个来源，两种渲染。
 *
 * - `cli` 面：给外部 Agent（Claude Code、Codex、Cursor、Gemini），由 `baocut skill install` 装进宿主的 skills 目录。
 * - `agent` 面：给 BaoCut 自己的会话内智能体（工具桥），SKILL.md 正文成为指导的「工作方式」段，`references/catalog/*.md`
 *   与 `workflows.md` 成为内置 skill（`renderAgentGuidance`）。
 *
 * 标记法（写正文的人与渲染器的约定，各占一行的标记都要整行只有它）：
 *
 * - 面取舍：`<!-- surface: cli -->` … `<!-- /surface -->`（或 `agent`），不嵌套；渲染时保留本面的内容，另一面的整段连同标记行删掉。
 * - `{{tool:a_b}}`：CLI 面 `baocut a b`（多词动词 `_` → `-`），工具桥面 `a_b`。
 * - `{{arg:camelCase}}`：CLI 面 `--kebab-case`，工具桥面 `camelCase`。
 * - 这两种的输出套反引号（`` `baocut a b` ``）；占位符本身已在反引号或代码块里时不再套。
 * - `{{skill:id}}`：CLI 面是指向 `references/craft/<id>.md` 的链接（路径相对当前文件）；工具桥面是「`` `id` ``（用 `skills_read` 读）」，
 *   跟在「见」「按」「做法在」或表格、列举后面都通顺；前面紧挨着「读」时整句改成「用 `skills_read` 读 `` `id` ``」，不说两遍「读」。
 * - 只在会话里有、CLI 面没有对应命令的工具（`SESSION_ONLY_TOOLS`，如 `downloads_save`）：CLI 面换成不提工具名的兜底写法，
 *   正文里的裸名（craft 同步来的）与 `{{tool:…}}` 一样处理；工具桥面原样。
 * - 页面之间的相对链接：CLI 面原样（链到的文件必须存在）；工具桥面没有文件可点，改写成内置 skill 的引用——
 *   `[文字](references/catalog/x.md)` → 「文字（用 `skills_read` 读 `baocut-catalog-x`）」，`workflows.md`、`conventions.md`
 *   同理（`baocut-workflows`、`baocut-conventions`），craft 副本 → 读 craft 本身的 id；工具桥面没有的页（`start.md`、`mcp.md`
 *   这类只给 CLI 的页）退成纯文字。
 * - 工具桥面不输出 `references/craft/`：会话内智能体用 `skills_read` 读本机的 skill，不读随说明书发布的副本。
 * - 生成块：`<!-- generated: <名字> -->` … `<!-- /generated -->`。内容由同步脚本（`tools/sync-agent-skill.ts`）写进源文件，
 *   渲染器不重算，只像正文一样处理里面的标记与占位符，标记行保留。
 *
 * 不认识的占位符、不认识的面或生成块、没有闭合或嵌套的标记一律抛 `AgentSkillRenderError`（带文件与行号），不默默放过。
 * 名字的转换规则只有一份（`@baocut/protocol` 的 `toolCommandName`、`fieldFlagName`），与 CLI 的命令树、旗标相同。
 */

export type AgentSkillFace = 'cli' | 'agent';

/** 说明书的 skill id，也是它在宿主 skills 目录里的目录名。 */
export const AGENT_SKILL_ID = 'baocut';
export const AGENT_SKILL_ENTRY = 'SKILL.md';
/** craft 副本的目录（由 `skills/<id>/` 同步，§8.3）。 */
export const AGENT_SKILL_CRAFT_DIR = 'references/craft';
/** 生成块的名字。 */
export const AGENT_SKILL_GENERATED_BLOCKS = ['common-ops', 'error-codes', 'tool-map'] as const;
export type AgentSkillGeneratedBlock = (typeof AGENT_SKILL_GENERATED_BLOCKS)[number];

/** 相对路径（`/` 分隔）→ 文件内容。 */
export type AgentSkillFiles = Map<string, string>;

/** 用来核对 `{{tool:…}}` 的目录：这个面能看到的工具。 */
export interface AgentSkillCatalog {
  tools: ReadonlyArray<{ name: string }>;
}

export interface RenderAgentSkillOptions {
  face: AgentSkillFace;
  /** 给出时，`{{tool:…}}` 里的名字必须在目录里（CLI 面给 `surfaces` 含 `cli` 的目录，工具桥面给 `agent` 的）。 */
  catalog?: AgentSkillCatalog | null;
}

export interface RenderAgentSkillTextOptions extends RenderAgentSkillOptions {
  /** 文件的相对路径：报错、`{{skill:…}}` 与页面链接的相对路径都按它。 */
  file: string;
  /** 已知的 craft id；给出时 `{{skill:…}}` 必须在里面。 */
  craftIds?: ReadonlySet<string> | null;
  /** 说明书里的全部文件；给出时页面之间的相对链接必须指向其中一个。 */
  files?: ReadonlySet<string> | null;
}

export class AgentSkillRenderError extends Error {
  readonly file: string;
  readonly line: number;
  /** 带文件与行号的整句（`message` 是它的文字）：引用随 `catalog.agentSkill` 的错误过线，CLI 按自己的语言显示。 */
  readonly localized: Localized;
  /** 不带文件与行号的那一句：换了位置重新报错时用（同步脚本把行号换算回源文件）。 */
  readonly problem: Localized | string;

  /** `problem` 是文案目录（rcSkills）的一条；同步脚本这类仓库工具也可以给纯文字。 */
  constructor(file: string, line: number, problem: Localized | string) {
    const localized =
      line > 0 ? RcSkills.renderErrorAt({ file, line, message: problem }) : RcSkills.renderErrorIn({ file, message: problem });
    super(localized.text);
    this.name = 'AgentSkillRenderError';
    this.file = file;
    this.line = line;
    this.localized = localized;
    this.problem = problem;
  }
}

const SURFACE_OPEN = /^\s*<!--\s*surface:\s*(\S+?)\s*-->\s*$/;
const SURFACE_CLOSE = /^\s*<!--\s*\/surface\s*-->\s*$/;
const GENERATED_OPEN = /^\s*<!--\s*generated:\s*(\S+?)\s*-->\s*$/;
const GENERATED_CLOSE = /^\s*<!--\s*\/generated\s*-->\s*$/;
/** 占位符；前面紧挨着的「读」一并捕获（`{{skill:…}}` 在工具桥面要吞掉它，其余占位符原样放回）。「通读」「阅读」这类不算。 */
const PLACEHOLDER = /((?<![通阅解朗宣研])读\s*)?\{\{([^{}\n]*)\}\}/g;
const TOOL_NAME = /^[a-z]+(?:_[a-z]+)*$/;
const ARG_NAME = /^[a-z][A-Za-z0-9]*$/;
const SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FENCE = /^\s*(```|~~~)/;
/** 指向 `.md` 的相对链接（可带锚点）；`[文字](目标)`。 */
const MD_LINK = /\[([^\]\n]+)\]\(([^()\s]+?\.md)(#[^()\s]*)?\)/g;
const FACES: readonly string[] = ['cli', 'agent'];

/** 只在会话里有、CLI 面没有对应命令的工具在 CLI 面的写法。 */
export interface SessionOnlyToolFallback {
  /** 常见的整句说法（工具名写成裸名、行内代码或 `{{tool:…}}` 都认）→ 换成 `replacement`。 */
  phrase: RegExp;
  replacement: string;
  /** 其余地方出现的工具名换成这句。 */
  text: string;
}

/**
 * 会话内智能体有、终端没有的工具（`surfaces` 含 `agent`、不含 `cli`）在 CLI 面的兜底写法：外部 Agent 没有这个工具，
 * 也不该读到它的名字。只登记 craft 与说明书里真会出现的；没登记的仍由同步脚本提醒。
 */
// i18n-ignore-start: 给模型的工具说明、错误与下一步
export const SESSION_ONLY_TOOLS: Readonly<Record<string, SessionOnlyToolFallback>> = {
  // 会话不一定属于项目，写好的文件要放进下载目录用户才看得到；终端里文件就写在用户自己的目录，直接给路径。
  downloads_save: {
    phrase: new RegExp(
      `用\\s*${toolNamePattern('downloads_save')}\\s*(?:把[^，。；\\n]*?)?放进下载目录(?:，把它返回的\\s*\`?path\`?\\s*告诉用户)?`,
      'g',
    ),
    replacement: '把文件的路径告诉用户（终端里没有下载目录这一步：文件就在你写的位置）',
    text: '把文件交给用户（终端里直接告诉用户文件的路径）',
  },
};
// i18n-ignore-end

/** 一个工具名在正文里的几种写法：裸名、行内代码、`{{tool:…}}`。 */
function toolNamePattern(name: string): string {
  return `(?:\\{\\{\\s*tool:\\s*${name}\\s*\\}\\}|\`${name}\`|(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_]))`;
}

/** CLI 面：会话专属工具换成兜底写法（先换整句，再换剩下的名字）。 */
export function renderSessionOnlyTools(line: string): string {
  let out = line;
  for (const [name, fallback] of Object.entries(SESSION_ONLY_TOOLS)) {
    out = out.replace(fallback.phrase, fallback.replacement).replace(new RegExp(toolNamePattern(name), 'g'), fallback.text);
  }
  return out;
}

/** 读一个说明书目录：全部文件（不含点开头的），相对路径按 `/` 分隔、排序。目录里有符号链接时抛错，不读到目录外。 */
export function readAgentSkillDir(dir: string): AgentSkillFiles {
  const files: AgentSkillFiles = new Map();
  const walk = (abs: string, rel: string) => {
    const entries = fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childAbs = path.join(abs, entry.name);
      if (entry.isSymbolicLink()) throw new AgentSkillRenderError(childRel, 0, RcSkills.agentSkillNoSymlinks());
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.isFile()) files.set(childRel, fs.readFileSync(childAbs, 'utf8'));
    }
  };
  walk(dir, '');
  return files;
}

/** 渲染整个说明书：同样结构的文件集合。`.md` 按标记法处理，其余文件原样。 */
export function renderAgentSkill(source: string | AgentSkillFiles, options: RenderAgentSkillOptions): AgentSkillFiles {
  const files = typeof source === 'string' ? readAgentSkillDir(source) : source;
  if (!files.has(AGENT_SKILL_ENTRY)) {
    throw new AgentSkillRenderError(AGENT_SKILL_ENTRY, 0, RcSkills.agentSkillNoEntry({ file: AGENT_SKILL_ENTRY }));
  }
  const craftIds = craftIdsOf(files);
  const known = new Set(files.keys());
  const out: AgentSkillFiles = new Map();
  for (const [file, text] of files) {
    if (options.face === 'agent' && file.startsWith(`${AGENT_SKILL_CRAFT_DIR}/`)) continue;
    out.set(file, file.endsWith('.md') ? renderAgentSkillText(text, { ...options, file, craftIds, files: known }) : text);
  }
  return out;
}

/**
 * 说明书里已有的 craft 副本（`references/craft/<id>.md`，id 是小写连字符名，`README.md` 这类说明文件不算）；一份都没有时
 * null（不核对 `{{skill:…}}`）。
 */
export function craftIdsOf(files: AgentSkillFiles | Iterable<string>): Set<string> | null {
  const prefix = `${AGENT_SKILL_CRAFT_DIR}/`;
  const names = files instanceof Map ? [...files.keys()] : [...(files as Iterable<string>)];
  const ids = names
    .filter((file) => file.startsWith(prefix) && file.endsWith('.md') && !file.slice(prefix.length).includes('/'))
    .map((file) => file.slice(prefix.length, -'.md'.length))
    .filter((id) => SKILL_ID.test(id));
  return ids.length ? new Set(ids) : null;
}

/** 渲染一个 Markdown 文件。craft 同步脚本对合成出的 craft 页也用它。 */
export function renderAgentSkillText(text: string, options: RenderAgentSkillTextOptions): string {
  const { face, file } = options;
  const known = options.catalog ? new Set(options.catalog.tools.map((tool) => tool.name)) : null;
  const lines = text.split('\n');
  const out: string[] = [];
  let surface: { face: string; line: number } | null = null;
  let generated: { name: string; line: number; insideSurface: boolean } | null = null;
  let fence: string | null = null;

  lines.forEach((line, index) => {
    const n = index + 1;
    const fail = (message: Localized): never => {
      throw new AgentSkillRenderError(file, n, message);
    };
    const visible = !surface || surface.face === face;

    const surfaceOpen = SURFACE_OPEN.exec(line);
    if (surfaceOpen) {
      if (surface) fail(RcSkills.surfaceNested({ line: surface.line }));
      if (!FACES.includes(surfaceOpen[1]!)) fail(RcSkills.unknownSurface({ face: surfaceOpen[1]! }));
      surface = { face: surfaceOpen[1]!, line: n };
      return;
    }
    if (SURFACE_CLOSE.test(line)) {
      if (!surface) fail(RcSkills.extraSurfaceClose());
      if (generated?.insideSurface) fail(RcSkills.generatedCrossesSurfaceClose({ line: generated.line }));
      surface = null;
      return;
    }
    const generatedOpen = GENERATED_OPEN.exec(line);
    if (generatedOpen) {
      if (generated) fail(RcSkills.generatedNested({ line: generated.line }));
      if (!(AGENT_SKILL_GENERATED_BLOCKS as readonly string[]).includes(generatedOpen[1]!)) {
        fail(
          RcSkills.unknownGenerated({
            name: generatedOpen[1]!,
            names: AGENT_SKILL_GENERATED_BLOCKS.join(RcAgentTools.listSeparator().text),
          }),
        );
      }
      generated = { name: generatedOpen[1]!, line: n, insideSurface: surface !== null };
      if (visible) out.push(line);
      return;
    }
    if (GENERATED_CLOSE.test(line)) {
      if (!generated) fail(RcSkills.extraGeneratedClose());
      if (generated!.insideSurface !== (surface !== null)) fail(RcSkills.generatedCrossesSurface({ line: generated!.line }));
      generated = null;
      if (visible) out.push(line);
      return;
    }
    if (!visible) return;
    const fenceMark = FENCE.exec(line)?.[1];
    if (fenceMark && (!fence || fence === fenceMark)) {
      fence = fence ? null : fenceMark;
      out.push(line);
      return;
    }
    out.push(renderPlaceholders(line, n, options, known, fence !== null));
  });

  if (surface) throw new AgentSkillRenderError(file, (surface as { line: number }).line, RcSkills.surfaceUnclosed());
  if (generated) throw new AgentSkillRenderError(file, (generated as { line: number }).line, RcSkills.generatedUnclosed());
  return out.join('\n');
}

function renderPlaceholders(
  line: string,
  n: number,
  options: RenderAgentSkillTextOptions,
  known: ReadonlySet<string> | null,
  inFence: boolean,
): string {
  const { face, file } = options;
  const fail = (message: Localized): never => {
    throw new AgentSkillRenderError(file, n, message);
  };
  if (face === 'cli' && !inFence) {
    const fallback = renderSessionOnlyTools(line);
    if (fallback !== line) return renderPlaceholders(fallback, n, options, known, inFence);
  }
  const code = (text: string, offset: number) => (inFence || insideInlineCode(line, offset) ? text : `\`${text}\``);
  const linked = inFence ? line : renderLinks(line, n, options);
  if (linked !== line) return renderPlaceholders(linked, n, { ...options, files: null }, known, inFence);
  const rendered = line.replace(PLACEHOLDER, (match, lead: string | undefined, inner: string, offset: number) => {
    const whole = lead ? match.slice(lead.length) : match;
    const at = offset + (lead?.length ?? 0);
    const colon = inner.indexOf(':');
    const kind = colon < 0 ? inner : inner.slice(0, colon);
    const value = colon < 0 ? '' : inner.slice(colon + 1).trim();
    switch (kind.trim()) {
      case 'tool': {
        if (!TOOL_NAME.test(value)) fail(RcSkills.badToolName({ placeholder: whole }));
        if (known && !known.has(value)) fail(RcSkills.toolNotInCatalog({ placeholder: whole, face }));
        return (lead ?? '') + code(face === 'cli' ? `baocut ${toolCommandName(value).display}` : value, at);
      }
      case 'arg': {
        if (!ARG_NAME.test(value)) fail(RcSkills.badArgName({ placeholder: whole }));
        return (lead ?? '') + code(face === 'cli' ? `--${fieldFlagName(value)}` : value, at);
      }
      case 'skill': {
        if (!SKILL_ID.test(value)) fail(RcSkills.badCraftId({ placeholder: whole }));
        if (options.craftIds && !options.craftIds.has(value)) fail(RcSkills.craftNotFound({ placeholder: whole, dir: AGENT_SKILL_CRAFT_DIR }));
        // i18n-ignore: 给模型的工具说明、错误与下一步
        if (face === 'agent') return lead ? `用 \`skills_read\` 读 \`${value}\`` : `\`${value}\`（用 \`skills_read\` 读）`;
        const target = `${AGENT_SKILL_CRAFT_DIR}/${value}.md`;
        return `${lead ?? ''}[${value}](${path.posix.relative(path.posix.dirname(file), target)})`;
      }
      default:
        return fail(RcSkills.unknownPlaceholder({ placeholder: whole }));
    }
  });
  if (rendered.includes('{{')) fail(RcSkills.placeholderUnclosed());
  return rendered;
}

/** `offset` 处是否在行内代码里（前面的反引号是奇数个）。 */
function insideInlineCode(line: string, offset: number): boolean {
  let ticks = 0;
  for (let i = 0; i < offset; i++) if (line[i] === '`') ticks++;
  return ticks % 2 === 1;
}

/**
 * 页面之间的相对链接。CLI 面原样，只核对目标存在；工具桥面改写成内置 skill 的引用，工具桥面没有的页退成纯文字。
 * 行内代码里的不动。
 */
function renderLinks(line: string, n: number, options: RenderAgentSkillTextOptions): string {
  const { face, file, files } = options;
  return line.replace(MD_LINK, (whole, text: string, target: string, _anchor: string | undefined, offset: number) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || insideInlineCode(line, offset)) return whole;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
    if (files && !files.has(resolved)) throw new AgentSkillRenderError(file, n, RcSkills.linkTargetMissing({ link: whole, target: resolved }));
    if (face === 'cli') return whole;
    const id = agentPageId(resolved);
    // i18n-ignore: 给模型的工具说明、错误与下一步
    return id ? `${text}（用 \`skills_read\` 读 \`${id}\`）` : text;
  });
}

/** 工具桥面里一个说明书文件对应的内置 skill id；工具桥面没有这一页时 null。 */
export function agentPageId(file: string): string | null {
  const catalog = /^references\/catalog\/([^/]+)\.md$/.exec(file);
  if (catalog) return `baocut-catalog-${catalog[1]}`;
  if (file === 'references/workflows.md') return 'baocut-workflows';
  if (file === 'references/conventions.md') return 'baocut-conventions';
  const craft = new RegExp(`^${AGENT_SKILL_CRAFT_DIR}/([^/]+)\\.md$`).exec(file);
  if (craft && SKILL_ID.test(craft[1]!)) return craft[1]!;
  return null;
}

/**
 * 「硬规则」标题下列表的条数（§8.6：两面渲染出的硬规则条数相同）。标题是任意级别里含「硬规则」的那个，列表只数顶格的
 * `-`、`*` 与 `1.` 项，到同级或更高级的下一个标题为止。没有这个标题时 0。
 */
export function countHardRules(rendered: string): number {
  const lines = rendered.split('\n');
  // i18n-ignore: 解析用的关键词
  const start = lines.findIndex((line) => /^#{1,6}\s+.*硬规则/.test(line));
  if (start < 0) return 0;
  const level = /^(#+)/.exec(lines[start]!)![1]!.length;
  let count = 0;
  for (const line of lines.slice(start + 1)) {
    const heading = /^(#{1,6})\s/.exec(line);
    if (heading && heading[1]!.length <= level) break;
    if (/^(?:[-*+]|\d+[.)])\s+\S/.test(line)) count++;
  }
  return count;
}

/** 内置 skill 形态的一页（工具桥面）：`references/catalog/*.md`、`workflows.md` 与 `conventions.md` 各一份。 */
export interface AgentSkillPage {
  /** `baocut-catalog-media`、`baocut-workflows`、`baocut-conventions`。 */
  id: string;
  /** 来源文件在说明书里的相对路径（`references/catalog/media.md`）。 */
  file: string;
  name: string;
  description: string;
  /** 去掉 front matter 与生成块标记的正文。 */
  body: string;
}

export interface AgentGuidance {
  /** SKILL.md 正文（去掉 front matter），作为会话指导的「工作方式」段。 */
  guidance: string;
  pages: AgentSkillPage[];
}

/**
 * 工具桥面：SKILL.md 正文渲染成会话指导的「工作方式」段，`references/catalog/*.md`、`references/workflows.md` 与
 * `references/conventions.md` 渲染成内置 skill 的形态（id 见 `agentPageId`，与工具桥面里改写后的链接一致）。页面的
 * `name` / `description` 取 front matter；没有 front matter 时取第一个 `#` 标题与其后的第一段。工具桥面正文为空的页
 * （整页只给 CLI 面，如 `catalog/web.md`）不登记；指导或别的页引用了它时抛 `AgentSkillRenderError`。
 */
export function renderAgentGuidance(source: string | AgentSkillFiles, catalog?: AgentSkillCatalog | null): AgentGuidance {
  const rendered = renderAgentSkill(source, { face: 'agent', catalog: catalog ?? null });
  const guidance = cleanBody(splitFrontmatter(rendered.get(AGENT_SKILL_ENTRY)!, AGENT_SKILL_ENTRY).body);
  const pages: AgentSkillPage[] = [];
  /** 工具桥面正文为空的页（整页只给 CLI 面）：不登记成说明书页。 */
  const skipped: string[] = [];
  const catalogPages = [...rendered.keys()].filter((file) => /^references\/catalog\/[^/]+\.md$/.test(file)).sort();
  const others = ['references/workflows.md', 'references/conventions.md'].filter((file) => rendered.has(file));
  for (const file of [...catalogPages, ...others]) {
    const id = agentPageId(file)!;
    const { fields, body } = splitFrontmatter(rendered.get(file)!, file);
    const text = cleanBody(body);
    if (!hasBody(text)) {
      skipped.push(id);
      continue;
    }
    const name = fields.get('name') || firstHeading(text) || id;
    const description = fields.get('description') || firstParagraph(text);
    pages.push({ id, file, name, description, body: text });
  }
  // 跳过的页在工具桥面读不到：指导与别的页不能引用它（指向它的链接要放进 cli 面）。
  for (const [file, text] of [[AGENT_SKILL_ENTRY, guidance] as const, ...pages.map((page) => [page.file, page.body] as const)]) {
    const dangling = skipped.find((id) => text.includes(`\`${id}\``));
    if (dangling)
      throw new AgentSkillRenderError(file, 0, RcSkills.cliOnlyPageLink({ page: dangling }));
  }
  return { guidance, pages };
}

/** 除了标题与空行还有没有正文。整页包在 `<!-- surface: cli -->` 里的页，工具桥面只剩 front matter（与标题）。 */
function hasBody(text: string): boolean {
  return text.split('\n').some((line) => line.trim() !== '' && !/^#{1,6}\s/.test(line));
}

function splitFrontmatter(text: string, file: string): { fields: Map<string, string>; body: string } {
  if (!/^﻿?---\s*\n/.test(text)) return { fields: new Map(), body: text };
  const parsed = parseSkillFrontmatter(text);
  if (!parsed.ok) throw new AgentSkillRenderError(file, 0, parsed.problem);
  return { fields: parsed.fields, body: parsed.body };
}

/** 去掉生成块的标记行（提示词里不需要），收掉首尾空行。 */
function cleanBody(body: string): string {
  return body
    .split('\n')
    .filter((line) => !GENERATED_OPEN.test(line) && !GENERATED_CLOSE.test(line))
    .join('\n')
    .trim();
}

function firstHeading(text: string): string {
  return /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? '';
}

function firstParagraph(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).map((block) => block.trim());
  const paragraph = paragraphs.find((block) => block && !block.startsWith('#') && !block.startsWith('<!--') && !block.startsWith('|'));
  return paragraph ? paragraph.replace(/\s*\n\s*/g, ' ') : '';
}

/**
 * 找说明书的根目录（里面是 `baocut/`）：`BAOCUT_AGENT_SKILLS_DIR` → 打包后的 `<resources>/agent-skills`（Electron 的
 * `process.resourcesPath`，再依次看 `resourceDirs`：CLI 传装好的 BaoCut 应用的资源目录）→ 从本模块往上找仓库根的
 * `agent-skills/`。与 `resolveBuiltinSkillsDir` 的顺序相同；都没有时 null。
 */
export function resolveBuiltinAgentSkillsDir(env: NodeJS.ProcessEnv = process.env, resourceDirs: readonly string[] = []): string | null {
  if (env.BAOCUT_AGENT_SKILLS_DIR) return env.BAOCUT_AGENT_SKILLS_DIR;
  const electron = (process as { resourcesPath?: string }).resourcesPath;
  for (const resources of [...(electron ? [electron] : []), ...resourceDirs]) {
    const bundled = path.join(resources, 'agent-skills');
    if (isDirectory(bundled)) return bundled;
  }
  return findRepoDir('agent-skills');
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
