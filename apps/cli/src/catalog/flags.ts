import { statSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fieldFlagName } from '@baocut/protocol';
import { M } from '../cli-copy.ts';
import { CliError, isRecord } from '../envelope.ts';
import type { CatalogCommand } from './command-tree.ts';

/**
 * 命令行 → 工具参数（Agent 面设计 §5.3）。旗标由目录项的 JSON Schema 派生，不手写：
 *
 * - 字段名 `camelCase` → `--kebab-case`（`documentId` → `--document-id`）；`--flag=value` 与 `--flag value` 都行。
 * - 布尔是开关，`--no-x` 给 false；字段名本身以 `no` 开头的（`noVideo`）按字段名 `--no-video` 直接匹配，不当成否定。
 *   既能是布尔又能是别的（`export.bilingual`、`loudness`）的也是开关，别的取值写成 `--x=<值>`。
 * - 数字按十进制解析；枚举与固定取值（`sampleRate`）当场检查。
 * - 数组可以重复给（`--glossary a --glossary b`），也可以给一个 JSON 数组；元素是枚举或有固定格式的（`kinds`、`at`）还可以逗号分隔。
 * - 对象与对象数组给 JSON 字面量、`@文件` 或 `-`（stdin）；`{start, end}` 的范围可以写 `a:b`，`{num, den}` 的帧率可以写
 *   `30000/1001` 或 `30`。
 * - 没有固定格式的文本字段（`speak --text`、`documents put` 以外的大段文字）接受 `@文件` 与 `-`；要以 `@` 开头的字面量写 `@@`。
 * - 位置参数只有一个，由目录项的 `positional` 指定；它与同名旗标二选一。`positional` 是数组（`transcode` 的 `files`）时收下全部位置参数。
 * - 目录项的 `cliSwitches` 是快捷开关：`transcribe --replace` 等于 `--target replace`，与那个字段的旗标二选一。
 *
 * 保留给 CLI 自己的旗标见 `GLOBAL_FLAGS`；目录字段派生出的旗标不得与它们重名（`dryRun` 与 `project` 是有意的，见下）。
 */

export interface GlobalFlags {
  /** `--json` / `--no-json`；不给时按 stdout 是不是 TTY。 */
  json: boolean | undefined;
  /** `--project <目录或 id>`。 */
  project: string | undefined;
  yes: boolean;
  /** `--wait` / `--no-wait`；不给时返回任务的命令默认等待。 */
  wait: boolean | undefined;
  /** `--timeout <秒>`：等待的上限。 */
  timeout: number | undefined;
  /** `--progress jsonl|text`。 */
  progress: 'jsonl' | 'text' | undefined;
  maxBytes: number;
  /** `--result-file <文件>`：完整结果写到这个文件（§5.5）。`--out` 不是 CLI 的，留给工具自己的 `out` 字段。 */
  resultFile: string | undefined;
  noStart: boolean;
  dryRun: boolean;
  help: boolean;
}

/** 结果的默认预算（§5.5）：超过时写到文件，stdout 只给摘要。 */
export const DEFAULT_MAX_BYTES = 64 * 1024;

/**
 * CLI 保留的旗标。`--dry-run` 映射到有 `dryRun` 字段的工具（`edits apply`），`--project` 同时给 `catalog.call` 的项目与
 * 有 `project` 字段的工具；其余字段派生出的旗标都不得与这些重名（`catalog-snapshot.test.ts` 检查）。
 */
export const GLOBAL_FLAGS = [
  'json',
  'no-json',
  'project',
  'yes',
  'wait',
  'no-wait',
  'timeout',
  'progress',
  'max-bytes',
  'result-file',
  'no-start',
  'dry-run',
  'help',
] as const;

const VALUE_FLAGS = new Set(['project', 'timeout', 'progress', 'max-bytes', 'result-file']);

export function defaultGlobals(): GlobalFlags {
  return {
    json: undefined,
    project: undefined,
    yes: false,
    wait: undefined,
    timeout: undefined,
    progress: undefined,
    maxBytes: DEFAULT_MAX_BYTES,
    resultFile: undefined,
    noStart: false,
    dryRun: false,
    help: false,
  };
}

/** 从命令行里取出 CLI 自己的旗标（出现在哪里都行，`--` 之后的不算），其余原样留下。 */
export function extractGlobals(argv: readonly string[]): { globals: GlobalFlags; rest: string[] } {
  const globals = defaultGlobals();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--') {
      rest.push(...argv.slice(i));
      break;
    }
    if (token === '-h') {
      globals.help = true;
      continue;
    }
    if (!token.startsWith('--')) {
      rest.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const name = token.slice(2, eq < 0 ? undefined : eq);
    if (!(GLOBAL_FLAGS as readonly string[]).includes(name)) {
      rest.push(token);
      continue;
    }
    let value: string | undefined = eq < 0 ? undefined : token.slice(eq + 1);
    if (VALUE_FLAGS.has(name) && value === undefined) {
      value = argv[i + 1];
      if (value === undefined) throw invalid(M.missingValue(`--${name}`));
      i++;
    } else if (!VALUE_FLAGS.has(name) && value !== undefined) {
      throw invalid(M.noValueExpected(`--${name}`));
    }
    switch (name) {
      case 'json':
      case 'no-json':
        globals.json = name === 'json';
        break;
      case 'project':
        globals.project = value;
        break;
      case 'yes':
        globals.yes = true;
        break;
      case 'wait':
      case 'no-wait':
        globals.wait = name === 'wait';
        break;
      case 'timeout': {
        const seconds = Number(value);
        if (!value || !Number.isFinite(seconds) || seconds <= 0) throw invalid(M.badNumber('--timeout', value ?? ''));
        globals.timeout = seconds;
        break;
      }
      case 'progress':
        if (value !== 'jsonl' && value !== 'text') throw invalid(M.badChoice('--progress', value ?? '', ['jsonl', 'text']));
        globals.progress = value;
        break;
      case 'max-bytes': {
        const bytes = Number(value);
        if (!value || !Number.isInteger(bytes) || bytes <= 0) throw invalid(M.badInteger('--max-bytes', value ?? ''));
        globals.maxBytes = bytes;
        break;
      }
      case 'result-file':
        globals.resultFile = value;
        break;
      case 'no-start':
        globals.noStart = true;
        break;
      case 'dry-run':
        globals.dryRun = true;
        break;
      case 'help':
        globals.help = true;
        break;
    }
  }
  return { globals, rest };
}

/** 读 `@文件` 与 `-`（stdin）。测试注入。 */
export interface InputSource {
  readFile(file: string): Promise<string>;
  readStdin(): Promise<string>;
  cwd: string;
}

export function processInput(cwd: string): InputSource {
  return {
    cwd,
    readFile: (file) => fs.readFile(path.resolve(cwd, file), 'utf8'),
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString('utf8');
    },
  };
}

type Schema = Record<string, unknown>;

/** 一个字段派生出的旗标。 */
export interface FlagSpec {
  field: string;
  flag: string;
  schema: Schema;
  required: boolean;
  /** 开关：不带值（布尔，或含布尔分支的 anyOf）。 */
  switch: boolean;
  array: boolean;
}

/** `documentId` → `document-id`。 */
export function kebab(field: string): string {
  return fieldFlagName(field);
}

export function flagSpecs(schema: Schema): FlagSpec[] {
  const properties = (isRecord(schema.properties) ? schema.properties : {}) as Record<string, Schema>;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  return Object.entries(properties).map(([field, property]) => ({
    field,
    flag: kebab(field),
    schema: property,
    required: required.has(field),
    switch: hasBoolean(property),
    array: property.type === 'array',
  }));
}

function hasBoolean(schema: Schema): boolean {
  if (schema.type === 'boolean') return true;
  return Array.isArray(schema.anyOf) && (schema.anyOf as Schema[]).some((branch) => branch.type === 'boolean');
}

/** 解析一条派生命令的参数（命令名之后的部分，CLI 自己的旗标已经取出）。 */
export async function parseToolArgs(
  command: CatalogCommand,
  argv: readonly string[],
  globals: GlobalFlags,
  input: InputSource,
): Promise<Record<string, unknown>> {
  const { tool } = command;
  const specs = flagSpecs(tool.inputSchema);
  const byFlag = new Map(specs.map((spec) => [spec.flag, spec]));
  const reader = new Reader(input);
  const args: Record<string, unknown> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith('--') || token.length === 2) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const name = token.slice(2, eq < 0 ? undefined : eq);
    const inline = eq < 0 ? undefined : token.slice(eq + 1);
    let spec = byFlag.get(name);
    const shortcut = spec ? undefined : tool.cliSwitches?.find((entry) => entry.flag === name);
    if (shortcut) {
      if (inline !== undefined) throw invalid(M.noValueExpected(`--${name}`));
      const target = specs.find((entry) => entry.field === shortcut.field);
      if (!target) throw invalid(M.unknownFlag(`--${name}`, command.display), { flag: `--${name}` });
      setOnce(args, target, shortcut.value);
      continue;
    }
    let negated = false;
    if (!spec && name.startsWith('no-')) {
      const base = byFlag.get(name.slice(3));
      if (base?.switch) {
        spec = base;
        negated = true;
      }
    }
    if (!spec) throw invalid(M.unknownFlag(`--${name}`, command.display), { flag: `--${name}` });
    if (negated) {
      if (inline !== undefined) throw invalid(M.noValueExpected(`--${name}`));
      setOnce(args, spec, false);
      continue;
    }
    if (spec.switch) {
      setOnce(args, spec, inline === undefined ? true : await coerce(spec.schema, inline, `--${spec.flag}`, reader));
      continue;
    }
    let raw = inline;
    if (raw === undefined) {
      raw = argv[i + 1];
      if (raw === undefined || (raw.startsWith('--') && raw.length > 2)) throw invalid(M.missingValue(`--${spec.flag}`));
      i++;
    }
    if (spec.array) {
      const items = await arrayItems(spec.schema, raw, `--${spec.flag}`, reader);
      args[spec.field] = [...((args[spec.field] as unknown[] | undefined) ?? []), ...items];
    } else {
      setOnce(args, spec, await coerce(spec.schema, raw, `--${spec.flag}`, reader));
    }
  }

  // 位置参数：只有 `positional` 指定的那一个字段，与同名旗标二选一。
  if (positionals.length > 0) {
    const spec = tool.positional ? specs.find((s) => s.field === tool.positional) : undefined;
    if (!spec) throw invalid(M.noPositional(command.display, positionals[0]!));
    if (args[spec.field] !== undefined) throw invalid(M.positionalAndFlag(spec.field, `--${spec.flag}`));
    if (spec.array) {
      const items: unknown[] = [];
      for (const raw of positionals) items.push(...(await arrayItems(spec.schema, raw, `<${spec.field}>`, reader)));
      args[spec.field] = items;
    } else {
      if (positionals.length > 1) throw invalid(M.tooManyPositionals(command.display, positionals.slice(1).join(' ')));
      args[spec.field] = await coerce(spec.schema, positionals[0]!, `<${spec.field}>`, reader);
    }
  }

  if (globals.dryRun) {
    if (!specs.some((spec) => spec.field === 'dryRun')) throw invalid(M.dryRunUnsupported(command.display));
    args.dryRun = true;
  }
  if (globals.project !== undefined && specs.some((spec) => spec.field === 'project') && args.project === undefined) {
    args.project = projectArgument(globals.project, input.cwd);
  }

  const missing = specs.filter((spec) => spec.required && args[spec.field] === undefined);
  if (missing.length > 0) {
    const names = missing.map((spec) => (spec.field === tool.positional ? `<${spec.field}> / --${spec.flag}` : `--${spec.flag}`));
    throw invalid(M.missingRequired(names.join(', '), command.display), { missing: missing.map((spec) => `--${spec.flag}`) });
  }
  return args;
}

/** `--project` 给工具的 `project` 字段：是目录时给绝对路径（工具认已登记项目目录的路径），否则原样当项目 id。 */
function projectArgument(value: string, cwd: string): string {
  return projectDirectory(value, cwd) ?? value;
}

/** `--project` 按 cwd 解析成存在的目录（绝对路径）；不是目录时 null（可能是项目 id）。 */
export function projectDirectory(value: string, cwd: string): string | null {
  const dir = path.resolve(cwd, value);
  try {
    return statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

function setOnce(args: Record<string, unknown>, spec: FlagSpec, value: unknown): void {
  if (args[spec.field] !== undefined) throw invalid(M.duplicateFlag(`--${spec.flag}`));
  args[spec.field] = value;
}

/** `@文件` 与 `-` 的来源；stdin 只能读一次。 */
class Reader {
  readonly #input: InputSource;
  #stdinUsed = false;

  constructor(input: InputSource) {
    this.#input = input;
  }

  async read(raw: string, flag: string): Promise<string> {
    if (raw === '-') {
      if (this.#stdinUsed) throw invalid(M.stdinTwice(flag));
      this.#stdinUsed = true;
      return this.#input.readStdin();
    }
    const file = raw.slice(1);
    try {
      return await this.#input.readFile(file);
    } catch (error) {
      throw invalid(M.readFileFailed(flag, file, error instanceof Error ? error.message : String(error)));
    }
  }

  async json(raw: string, flag: string): Promise<unknown> {
    const text = raw === '-' || raw.startsWith('@') ? await this.read(raw, flag) : raw;
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw invalid(M.badJson(flag, error instanceof Error ? error.message : String(error)));
    }
  }
}

/** 数组字段的一次出现：JSON 数组整体给，或一个元素（枚举与固定格式的元素可以逗号分隔）。 */
async function arrayItems(schema: Schema, raw: string, flag: string, reader: Reader): Promise<unknown[]> {
  const items = (isRecord(schema.items) ? schema.items : {}) as Schema;
  if (raw.startsWith('[') || raw === '-' || (raw.startsWith('@') && items.type === 'object')) {
    const parsed = await reader.json(raw, flag);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  if (items.type === 'string' && (Array.isArray(items.enum) || typeof items.pattern === 'string') && raw.includes(',')) {
    const parts = raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    return Promise.all(parts.map((part) => coerce(items, part, flag, reader, false)));
  }
  return [await coerce(items, raw, flag, reader, false)];
}

/** 一个取值按 schema 换成 JSON 值。`files` 为 false 时文本不读 `@文件`（数组的元素）。 */
async function coerce(schema: Schema, raw: string, flag: string, reader: Reader, files = true): Promise<unknown> {
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf as Schema[];
    if ((raw.startsWith('{') || raw.startsWith('[') || raw === '-' || raw.startsWith('@')) && branches.some((b) => b.type === 'object')) {
      return reader.json(raw, flag);
    }
    for (const branch of branches) {
      try {
        return await coerce(branch, raw, flag, reader, false);
      } catch {
        // 下一个分支。
      }
    }
    throw invalid(M.badValue(flag, raw));
  }
  if (schema.const !== undefined) {
    const value = schema.type === 'number' || schema.type === 'integer' ? Number(raw) : schema.type === 'boolean' ? raw === 'true' : raw;
    if (value !== schema.const) throw invalid(M.badValue(flag, raw));
    return value;
  }
  switch (schema.type) {
    case 'string': {
      if (Array.isArray(schema.enum)) {
        if (!(schema.enum as unknown[]).includes(raw)) throw invalid(M.badChoice(flag, raw, schema.enum as string[]));
        return raw;
      }
      if (files && typeof schema.pattern !== 'string') {
        if (raw === '-' || (raw.startsWith('@') && !raw.startsWith('@@'))) return reader.read(raw, flag);
        if (raw.startsWith('@@')) return raw.slice(1);
      }
      return raw;
    }
    case 'number':
    case 'integer': {
      const value = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(value)) throw invalid(M.badNumber(flag, raw));
      if (schema.type === 'integer' && !Number.isInteger(value)) throw invalid(M.badInteger(flag, raw));
      return value;
    }
    case 'boolean':
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      throw invalid(M.badBoolean(flag, raw));
    case 'object':
      return objectValue(schema, raw, flag, reader);
    case 'array':
      return arrayItems(schema, raw, flag, reader);
    default:
      // 没有类型（自由 JSON）：像 JSON 的按 JSON 解析，否则当字符串。
      return raw.startsWith('{') || raw.startsWith('[') || raw === '-' || raw.startsWith('@') ? reader.json(raw, flag) : raw;
  }
}

const RANGE = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;
const RATIO = /^(\d+)(?:\/(\d+))?$/;

/** 对象：`a:b` 的范围、`n/d` 的分数，或 JSON（字面量、`@文件`、`-`）。 */
async function objectValue(schema: Schema, raw: string, flag: string, reader: Reader): Promise<unknown> {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  if ('start' in properties && 'end' in properties) {
    const range = RANGE.exec(raw);
    if (range) return { start: Number(range[1]), end: Number(range[2]) };
  }
  if ('num' in properties && 'den' in properties) {
    const ratio = RATIO.exec(raw);
    if (ratio) return { num: Number(ratio[1]), den: Number(ratio[2] ?? 1) };
  }
  // 只有一个文本字段的对象（例如 `--replace <itemId>`）：不像 JSON、@文件或 - 的值就是那个字段。
  const single = soleTextField(schema);
  if (single && !(raw.startsWith('{') || raw === '-' || raw.startsWith('@'))) return { [single]: raw };
  const value = await reader.json(raw, flag);
  if (!isRecord(value)) throw invalid(M.expectedObject(flag));
  return value;
}

/** 对象只有一个字段、而且是文本时，那个字段的名字（命令行可以直接写它的值）。 */
export function soleTextField(schema: Schema): string | null {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const keys = Object.keys(properties);
  if (keys.length !== 1) return null;
  const field = properties[keys[0]!];
  return isRecord(field) && field.type === 'string' ? keys[0]! : null;
}

function invalid(message: string, extra: Record<string, unknown> = {}): CliError {
  return new CliError('INVALID_ARGUMENTS', message, extra);
}
