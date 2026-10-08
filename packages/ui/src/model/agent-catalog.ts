import { defineMessages, DRIVER_ID_PATTERN, isBuiltinDriverId, RpcError, type DriverId, type DriverInfo } from '@baocut/protocol';
import type { AcpCatalogEntry } from './acp-catalog.ts';
import { zhHans } from './agent-catalog.zh-Hans.ts';
import { zhHant } from './agent-catalog.zh-Hant.ts';
import { ja } from './agent-catalog.ja.ts';
import { ko } from './agent-catalog.ko.ts';
import { es } from './agent-catalog.es.ts';
import { fr } from './agent-catalog.fr.ts';
import { de } from './agent-catalog.de.ts';
import { nl } from './agent-catalog.nl.ts';
import { ptBR } from './agent-catalog.pt-BR.ts';
import { it } from './agent-catalog.it.ts';
import { ru } from './agent-catalog.ru.ts';
import { pl } from './agent-catalog.pl.ts';
import { tr } from './agent-catalog.tr.ts';
import { vi } from './agent-catalog.vi.ts';

/** 自定义 Agent 表单校验的文案（英文是键与类型的来源，译文在 `agent-catalog.zh-Hans.ts`）。 */
const en = {
  idEmpty: 'Enter an id, for example my-agent',
  idPattern: 'The id must start with a lowercase letter and use only lowercase letters, digits, and hyphens',
  idTooLong: 'The id can be at most 63 characters',
  idBuiltin: (id: string, who: string | null) => `“${id}” is the id of a built-in BaoCut agent${who ? ` (${who})` : ''}. Choose another id`,
  idTaken: (id: string, who: string | null) => `An agent${who ? ` (${who})` : ''} already uses “${id}”. Choose another id`,
  nameEmpty: 'Enter a name to show in the list',
  nameTooLong: (max: number) => `The name can be at most ${max} characters`,
  commandEmpty: 'Enter the command that starts it, for example my-agent --acp',
  commandShell: 'Enter a single command: BaoCut starts it directly, not through a shell, so pipes, redirects, and && don’t work',
  tooManyArgs: (max: number) => `Too many arguments: up to ${max}`,
  envLine: (line: number) => `Line ${line} must be KEY=VALUE, with KEY starting with a letter or underscore`,
};
export type AgentCatalogMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 设置 › Agent「添加更多 Agent」的纯层（原型 designs/baocut/app/model-agent-catalog.js，产品设计 §7.6）：目录搜索、
 * 自定义命令的拆分、环境变量的解析与表单校验、启动命令的展示，以及内置 Agent 的分组（常驻主列表 / 收进「更多」）。
 * 视图只组合；添加与移除走 `agents.addProvider` / `agents.removeProvider`，界面不在本地存添加的 Agent。
 */

/** 内置九家里收进「更多」折叠段的四家（经 ACP 接入）；其余五家常驻主列表，没装也列出。 */
export const MORE_BUILTIN_IDS: readonly DriverId[] = ['gemini', 'cursor', 'grok', 'kimi'];

/** 用户添加的（`agents.addProvider`），能移除；内置的只能停用。 */
export function isCustomDriver(driver: Pick<DriverInfo, 'source'>): boolean {
  return driver.source === 'custom';
}

/**
 * 进会话与工具的 Agent 选择器（原型 model-agent.js `listed`）：检测到的都进；没检测到的只有常驻主列表的内置几家进（带安装提示），
 * 「更多」四家与用户添加的没检测到时不进——一串「未安装」只会把能用的那一行淹掉。
 */
export function listedInPicker(driver: Pick<DriverInfo, 'id' | 'state' | 'source'>): boolean {
  if (driver.state !== 'not-installed') return true;
  return driver.source !== 'custom' && !MORE_BUILTIN_IDS.includes(driver.id);
}

// ---- 目录 ----

export interface CatalogRow extends AcpCatalogEntry {
  /** 已经添加过：行上换成「已添加」。 */
  added: boolean;
}

const norm = (text: unknown) => String(text ?? '').toLowerCase();

/**
 * 目录搜索：按空白拆词，每个词都要在名字、id、介绍或命令里出现（不分大小写）。空查询返回全部，次序同目录。
 * `addedIds` 里的条目标 `added`。
 */
export function searchCatalog(catalog: readonly AcpCatalogEntry[], query: string, addedIds: Iterable<DriverId>): CatalogRow[] {
  const taken = new Set(addedIds);
  const words = norm(query).split(/\s+/).filter(Boolean);
  return catalog
    .filter((e) => {
      const hay = norm([e.name, e.id, e.description, e.command.join(' ')].join(' '));
      return words.every((w) => hay.includes(w));
    })
    .map((e) => ({ ...e, added: taken.has(e.id) }));
}

// ---- 自定义命令 ----

/** 命令行按空白拆成数组；双引号或单引号包住的一段算一个参数（引号本身去掉）。 */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m = re.exec(line); m; m = re.exec(line)) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

/** 环境变量名：与协议一致（字母或下划线开头，字母、数字与下划线，最长 128）。 */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** 环境变量：每行一个 KEY=VALUE，空行忽略。`bad` 是第一处写错的行号（从 1 数），没有为 null。 */
export function parseEnv(text: string): { env: Record<string, string>; bad: number | null } {
  const env: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const at = line.indexOf('=');
    const key = at > 0 ? line.slice(0, at).trim() : '';
    if (!ENV_NAME.test(key)) return { env, bad: i + 1 };
    env[key] = line.slice(at + 1).trim();
  }
  return { env, bad: null };
}

export interface Launcher {
  kind: 'npx' | 'uvx';
  /** 包名带版本，例如 `cline@3.0.46`、`fast-agent-acp==0.9.22`。 */
  spec: string;
  /** 这台电脑上要先有的东西。 */
  needs: string;
}

const LAUNCHER_NEEDS = { npx: 'Node.js', uvx: 'uv' } as const;

/** 由包管理器现取现用（`npx -y 包@版本`、`uvx --from 包==版本 …`）的不用单独安装；否则 null。 */
export function launcherOf(command: readonly string[]): Launcher | null {
  const [exe, ...rest] = command;
  if (exe !== 'npx' && exe !== 'uvx') return null;
  const from = rest.indexOf('--from');
  const spec = exe === 'uvx' && from >= 0 ? rest[from + 1] : rest.find((t) => !t.startsWith('-'));
  return spec ? { kind: exe, spec, needs: LAUNCHER_NEEDS[exe] } : null;
}

export interface CustomForm {
  id: string;
  name: string;
  command: string;
  env: string;
}

export type CustomErrors = Partial<Record<keyof CustomForm, string>>;

const NAME_MAX = 100;
const ARGS_MAX = 64;
const SHELL_OPERATOR = /^(\||\|\||&&|;|>|>>|<)$/;

/**
 * 自定义命令表单的校验（原型 `validateCustom`，约束与协议 `agents.addProvider` 一致）：按字段的错误，没有错误的字段不出现。
 * `takenIds` = 内置的、已添加的与目录里的 id，撞上就提示换一个；`names` 用来说出撞上的是哪一家。
 */
export function validateCustom(form: CustomForm, takenIds: Iterable<DriverId>, names: Readonly<Record<string, string>> = {}): CustomErrors {
  const err: CustomErrors = {};
  const id = form.id.trim();
  const taken = new Set(takenIds);
  const who = names[id] && names[id] !== id ? names[id]! : null;
  if (!id) err.id = M.idEmpty;
  else if (!/^[a-z][a-z0-9-]*$/.test(id)) err.id = M.idPattern;
  else if (!DRIVER_ID_PATTERN.test(id)) err.id = M.idTooLong;
  else if (isBuiltinDriverId(id)) err.id = M.idBuiltin(id, who);
  else if (taken.has(id)) err.id = M.idTaken(id, who);
  const name = form.name.trim();
  if (!name) err.name = M.nameEmpty;
  else if (name.length > NAME_MAX) err.name = M.nameTooLong(NAME_MAX);
  const cmd = splitCommand(form.command);
  if (!cmd.length) err.command = M.commandEmpty;
  else if (cmd.some((t) => SHELL_OPERATOR.test(t)) || /[|;&<>]/.test(cmd[0]!)) {
    err.command = M.commandShell;
  } else if (cmd.length > ARGS_MAX) err.command = M.tooManyArgs(ARGS_MAX);
  const env = parseEnv(form.env);
  if (env.bad) err.env = M.envLine(env.bad);
  return err;
}

export const hasErrors = (err: CustomErrors) => Object.keys(err).length > 0;

/** 表单 → `agents.addProvider` 的参数（先校验过）。没填环境变量时不带 `env`。 */
export function customRequest(form: CustomForm): { id: DriverId; name: string; command: string[]; env?: Record<string, string> } {
  const { env } = parseEnv(form.env);
  return {
    id: form.id.trim(),
    name: form.name.trim(),
    command: splitCommand(form.command),
    ...(Object.keys(env).length ? { env } : {}),
  };
}

/** 目录条目 → `agents.addProvider` 的参数。 */
export function catalogRequest(entry: AcpCatalogEntry): { id: DriverId; name: string; command: string[]; env?: Record<string, string> } {
  return { id: entry.id, name: entry.name, command: [...entry.command], ...(entry.env ? { env: { ...entry.env } } : {}) };
}

const quoteArg = (t: string) => (/\s/.test(t) || t === '' ? `"${t}"` : t);

/**
 * 启动命令的展示：整行，环境变量在前。`env` 给值时原样显示（目录条目）；添加之后 Runtime 只给环境变量名
 * （`DriverInfo.custom.envKeys`，值可能是密钥），这时写成 `KEY=…`。
 */
export function launchLine(command: readonly string[], env?: Readonly<Record<string, string>> | readonly string[]): string {
  const vars = Array.isArray(env)
    ? (env as readonly string[]).map((k) => `${k}=…`)
    : Object.entries((env as Record<string, string> | undefined) ?? {}).map(([k, v]) => `${k}=${quoteArg(v)}`);
  return [...vars, ...command.map(quoteArg)].join(' ');
}

/** 添加的那家在终端里登录用的命令：npx / uvx 现取现用的起它自己（不带 ACP 的参数）；其余直接起它的程序（原型 `loginCmd`）。 */
export function customLoginCommand(command: readonly string[]): string {
  const launcher = launcherOf(command);
  if (launcher) {
    const at = command.indexOf(launcher.spec);
    if (at > 0) return command.slice(0, at + (launcher.kind === 'uvx' ? 2 : 1)).join(' ');
  }
  return command[0] ?? '';
}

/** `agents.addProvider` 因 id 重名被拒（`conflict`，`details.code: 'AGENT_PROVIDER_EXISTS'`）：界面把它写回 id 一栏。 */
export function isProviderExists(error: unknown): boolean {
  if (!(error instanceof RpcError) || error.code !== 'conflict') return false;
  const details = error.details as { code?: unknown } | null | undefined;
  return details?.code === 'AGENT_PROVIDER_EXISTS';
}
