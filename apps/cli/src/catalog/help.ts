import type { CatalogTool, ToolEffect } from '@baocut/protocol';
import { M } from '../cli-copy.ts';
import { isRecord } from '../envelope.ts';
import { buildTree, needsConfirmation, renderToolNames, summaryOf, type CatalogCommand } from './command-tree.ts';
import { flagSpecs, kebab, soleTextField, type FlagSpec } from './flags.ts';

/**
 * 帮助（Agent 面设计 §4.5、§5.7）：全部从目录派生。`baocut` / `--help` 一屏（不超过 40 行）：流程、对象、本机管理、更多；
 * `help <命令>` 给参数、效果与示例。工具说明（目录里的 `description`）是给模型的原文，不翻译；标题与提示按当前语言。
 */

/** 一屏帮助里流程与名词组的顺序（目录里新增的排在后面）。 */
const FLOW_ORDER = ['transcribe', 'translate', 'dub', 'download', 'export', 'transcode', 'speak', 'image'];
const NOUN_ORDER = [
  'videos',
  'documents',
  'edits',
  'captions',
  'assets',
  'jobs',
  'models',
  'space',
  'projects',
  'artifacts',
  'skills',
  'library',
];

/** 一屏帮助的行数上限（§5.7）。 */
export const HELP_MAX_LINES = 40;
const WIDTH = 100;

/** 管理桶的一个名词：一屏帮助只列名字，`help <名字>` 列子命令。 */
export interface AdminEntry {
  name: string;
  /** 子命令（`models configure|accounts|…`）；没有时只列名字。 */
  verbs?: readonly string[];
  /** 管理命令的用法正文（`admin/<名词>.ts` 手写）；`help <名词>` 把它放在派生命令之后。 */
  usage?: string;
}

export function renderMainHelp(tools: readonly CatalogTool[], admin: readonly AdminEntry[]): string {
  const tree = buildTree(tools);
  const out: string[] = [M.helpTagline, ''];

  out.push(M.helpFlows);
  const flows = ordered([...tree.verbs.keys()], FLOW_ORDER);
  const flowWidth = Math.max(...flows.map((name) => name.length)) + 3;
  for (const name of flows) {
    const summary = trimPeriod(summaryOf(tree.verbs.get(name)!.tool.description));
    out.push(`  ${name.padEnd(flowWidth)}${truncate(summary, WIDTH - flowWidth - 2)}`);
  }

  out.push(M.helpObjects);
  const nouns = ordered([...tree.nouns.keys()], NOUN_ORDER);
  const nounWidth = Math.max(...nouns.map((name) => name.length)) + 3;
  for (const noun of nouns) out.push(`  ${noun.padEnd(nounWidth)}${[...tree.nouns.get(noun)!.keys()].join(' · ')}`);

  out.push(M.helpAdmin);
  const adminWords = admin.map((entry) => (entry.verbs?.length ? `${entry.name} ${shortVerbs(entry.verbs)}` : entry.name));
  out.push(...wrap(adminWords, '  ', WIDTH));

  out.push(M.helpMore);
  out.push(`  ${'help <command>'.padEnd(18)}${M.helpMoreHelp}`);
  out.push(`  ${'spec [<name>]'.padEnd(18)}${M.helpMoreSpec}`);
  out.push(`  ${'status'.padEnd(18)}${M.helpMoreStatus}`);
  out.push(`  ${'runtime ensure|status|stop · version'}`);
  out.push(`  ${M.helpGlobalFlags}`, `  ${M.helpJobFlags}`);
  return out.join('\n');
}

/** `models configure|accounts|…`：最多列四个，其余用省略号。 */
function shortVerbs(verbs: readonly string[]): string {
  return verbs.length > 4 ? `${verbs.slice(0, 3).join('|')}|…` : verbs.join('|');
}

function ordered(names: string[], preferred: readonly string[]): string[] {
  const known = preferred.filter((name) => names.includes(name));
  return [...known, ...names.filter((name) => !preferred.includes(name))];
}

function wrap(words: readonly string[], separator: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line}${separator}${word}` : word;
    if (line && displayWidth(next) + 2 > width) {
      lines.push(`  ${line}`);
      line = word;
    } else line = next;
  }
  if (line) lines.push(`  ${line}`);
  return lines;
}

/** 名词组的帮助：目录里的动词与摘要，再列管理桶里同名词的子命令。 */
export function renderGroupHelp(tools: readonly CatalogTool[], noun: string, admin: AdminEntry | undefined): string | null {
  const group = buildTree(tools).nouns.get(noun);
  if (!group && !admin) return null;
  // 只有管理命令的名词（`chat`、`settings` 等）：直接给它的用法。
  if (!group && admin?.usage) return admin.usage;
  const out: string[] = [`baocut ${noun} <command>`, ''];
  if (group) {
    const width = Math.max(...[...group.keys()].map((verb) => verb.length)) + 3;
    for (const [verb, command] of group)
      out.push(`  ${verb.padEnd(width)}${truncate(trimPeriod(summaryOf(command.tool.description)), WIDTH - width - 2)}`);
  }
  if (admin?.usage) out.push('', `${M.helpAdminVerbs}:`, ...admin.usage.split('\n').filter((line) => line.startsWith('  ')));
  else if (admin?.verbs?.length) out.push('', M.helpAdminVerbs, ...wrap(admin.verbs, '   ', WIDTH));
  out.push('', M.helpGroupMore(noun));
  return out.join('\n');
}

/** `help <命令>`：用法、效果、说明、参数与示例。`names` 是目录里的全部工具名（说明里的工具名换成命令）。 */
export function renderCommandHelp(command: CatalogCommand, names: readonly string[] = []): string {
  const { tool } = command;
  const render = (text: string) => renderToolNames(text, names);
  const specs = flagSpecs(tool.inputSchema);
  const positional = tool.positional ? specs.find((spec) => spec.field === tool.positional) : undefined;
  const usage = [`baocut ${command.display}`];
  if (positional) usage.push(positional.required ? `<${positional.field}>` : `[<${positional.field}>]`);
  if (specs.some((spec) => spec !== positional)) usage.push(M.helpFlagsPlaceholder);
  const out = [usage.join(' '), '', `${tool.title} — ${M.effectLabel(effectText(tool.effect))}`, '', render(tool.description.trim()), ''];

  out.push(M.helpParameters);
  if (specs.length === 0) out.push(`  ${M.helpNoParameters}`);
  const left = specs.map((spec) => flagUsage(spec, spec === positional));
  const width = Math.min(Math.max(...left.map((text) => text.length), 0) + 2, 44);
  specs.forEach((spec, index) => {
    const notes = [spec.required ? M.helpRequired : '', spec.array ? M.helpRepeatable : ''].filter(Boolean).join(', ');
    const description = typeof spec.schema.description === 'string' ? render(spec.schema.description) : '';
    const text = [notes && `(${notes})`, description].filter(Boolean).join(' ');
    const head = `  ${left[index]!}`;
    out.push(head.length + 1 > width + 2 ? `${head}\n${' '.repeat(width + 2)}${text}` : `${head.padEnd(width + 2)}${text}`);
  });
  // 快捷开关（`cliSwitches`）：写成它等价的旗标。
  for (const entry of tool.cliSwitches ?? []) {
    const spec = specs.find((candidate) => candidate.field === entry.field);
    if (spec) out.push(`  ${`--${entry.flag}`.padEnd(width)}= --${spec.flag} ${String(entry.value)}`);
  }
  if (positional) out.push('', M.helpPositionalNote(`<${positional.field}>`, `--${positional.flag}`));

  if (tool.examples.length > 0) {
    out.push('', M.helpExamples);
    for (const example of tool.examples) out.push(`  # ${example.title}`, `  ${exampleCommand(command, example.args)}`);
  }
  out.push('', M.helpCommonFlags, `  ${commonFlags(tool)}`);
  return out.join('\n');
}

function effectText(effect: ToolEffect): string {
  return { query: M.effectQuery, mutation: M.effectMutation, job: M.effectJob, destructive: M.effectDestructive }[effect];
}

function commonFlags(tool: CatalogTool): string {
  const flags = ['--json', '--project <dir>', '--max-bytes <n>', '--result-file <file>', '--no-start'];
  if (tool.effect === 'job') flags.unshift('--no-wait', '--timeout <s>', '--progress jsonl');
  // `jobs wait` 与默认等待同一条路径（run.ts），只是没有「不等」。
  else if (tool.name === 'jobs_wait') flags.unshift('--timeout <s>', '--progress jsonl');
  if (needsConfirmation(tool)) flags.unshift('--yes');
  return flags.join('  ');
}

/** 一个旗标的写法：`--document-id <string>`、`--bilingual`、`--kind <audio|video>`、`<video> | --video <string>`。 */
function flagUsage(spec: FlagSpec, positional: boolean): string {
  const flag = spec.switch ? `--${spec.flag}${valueAlternative(spec.schema)}` : `--${spec.flag} ${placeholder(spec.schema)}`;
  return positional ? `<${spec.field}> | ${flag}` : flag;
}

/** 开关另有的取值（`--bilingual[=<json>]`）。 */
function valueAlternative(schema: Record<string, unknown>): string {
  if (!Array.isArray(schema.anyOf)) return '';
  const others = (schema.anyOf as Record<string, unknown>[]).filter((branch) => branch.type !== 'boolean');
  return others.length ? `[=${others.map(placeholder).join('|')}]` : '';
}

function placeholder(schema: Record<string, unknown>): string {
  if (Array.isArray(schema.anyOf)) return (schema.anyOf as Record<string, unknown>[]).map(placeholder).join('|');
  if (schema.const !== undefined) return String(schema.const);
  if (Array.isArray(schema.enum)) return `<${(schema.enum as unknown[]).join('|')}>`;
  switch (schema.type) {
    case 'array':
      return placeholder(isRecord(schema.items) ? schema.items : {});
    case 'object': {
      const properties = isRecord(schema.properties) ? schema.properties : {};
      if ('start' in properties && 'end' in properties) return '<a:b|json>';
      if ('num' in properties && 'den' in properties) return '<n/d|json>';
      const single = soleTextField(schema);
      if (single) return `<${single}|json>`;
      return '<json|@file|->';
    }
    case 'number':
    case 'integer':
      return '<n>';
    case 'boolean':
      return '<true|false>';
    default:
      return '<text>';
  }
}

/** 目录示例（JSON 参数）写成命令行；要确认的命令带上 `--yes`（示例是用户已经同意之后的写法）。 */
export function exampleCommand(command: CatalogCommand, args: Record<string, unknown>): string {
  const parts = ['baocut', command.display];
  const positional = command.tool.positional;
  const value = positional === undefined ? undefined : args[positional];
  if (positional && value !== undefined) {
    if (Array.isArray(value)) parts.push(...value.map((item) => shellQuote(String(item))));
    else if (typeof value !== 'object') parts.push(shellQuote(String(value)));
  }
  for (const [field, item] of Object.entries(args)) {
    if (field === positional && value !== undefined && (typeof value !== 'object' || Array.isArray(value))) continue;
    const flag = `--${kebab(field)}`;
    const shortcut = command.tool.cliSwitches?.find((entry) => entry.field === field && entry.value === item);
    if (shortcut) parts.push(`--${shortcut.flag}`);
    else if (item === true) parts.push(flag);
    else if (item === false) parts.push(field.startsWith('no') && /^no[A-Z]/.test(field) ? `${flag}=false` : `--no-${kebab(field)}`);
    else if (Array.isArray(item) && item.every((x) => typeof x !== 'object' || x === null))
      for (const x of item) parts.push(flag, shellQuote(String(x)));
    else if (isRange(item)) parts.push(flag, `${item.start}:${item.end}`);
    else if (typeof item === 'object' && item !== null) parts.push(flag, shellQuote(JSON.stringify(item)));
    else parts.push(flag, shellQuote(String(item)));
  }
  if (needsConfirmation(command.tool)) parts.push('--yes');
  return parts.join(' ');
}

function isRange(value: unknown): value is { start: number; end: number } {
  return isRecord(value) && Object.keys(value).length === 2 && typeof value.start === 'number' && typeof value.end === 'number';
}

function shellQuote(text: string): string {
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`;
}

function trimPeriod(text: string): string {
  return text.replace(/[。.]$/, '');
}

/** 终端里的显示宽度：全角字符算 2。 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += isWide(char.codePointAt(0)!) ? 2 : 1;
  return width;
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

function truncate(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  let out = '';
  for (const char of text) {
    if (displayWidth(out + char) + 1 > width) break;
    out += char;
  }
  return `${out}…`;
}
