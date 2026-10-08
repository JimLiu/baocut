import type { RiskLevel } from './access.ts';
import type { ToolEffect, ToolSurface } from './services.ts';

/**
 * Agent 面的工具目录经网关给 CLI（架构设计 §3.5、§4.1；命令与协议规范 §4.1）：`catalog.list` 列出目录，`catalog.call`
 * 按名调用。目录与会话里的智能体、MCP 服务是同一份（`ToolCatalog`），主体是 `LocalPrincipal`：用户本人在终端里操作，
 * 写入算 `user_local`，不走 BaoCut 的审批。只给 `cli` 与 `desktop` 连接，不在 Web 服务的白名单里。
 */

/** 目录里的一个工具。`inputSchema` 是参数的 JSON Schema（由 zod 生成）。 */
export interface CatalogTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  /** 动作的默认风险等级（架构设计 §3.12 的 `TOOL_RISK`；取决于参数的按调用时的为准）。 */
  risk: RiskLevel;
  /** 效果：`query` 只读、`mutation` 改状态、`job` 返回 `jobId`、`destructive` 不可撤销（CLI 要 `--yes`）。 */
  effect: ToolEffect;
  /** 一到三个最小调用示例（JSON 参数），`help <命令>` 与 `spec` 带出。 */
  examples: ReadonlyArray<{ title: string; args: Record<string, unknown> }>;
  /** 出现在哪些面；终端的目录里都含 `cli`。 */
  surfaces: ReadonlyArray<ToolSurface>;
  /** CLI 唯一的位置参数对应的字段名。 */
  positional?: string;
  /** CLI 的快捷开关：`--<flag>` 等于给 `field` 这个取值（`transcribe --replace` 即 `--target replace`）。不进 MCP 的 tools/list。 */
  cliSwitches?: ReadonlyArray<CatalogCliSwitch>;
}

/** 一个 CLI 快捷开关（`CatalogTool.cliSwitches`）。旗标不得与字段派生的旗标或 CLI 保留的旗标重名。 */
export interface CatalogCliSwitch {
  flag: string;
  field: string;
  value: string | number | boolean;
}

/**
 * `edits_ops` 的结果（操作族与每个操作的说明、JSON Schema 与示例）：CLI 的离线快照带上它，`spec edits.<op>` 不连 Runtime 也能给。
 */
export interface CatalogEditOperations {
  conventions: string;
  families: { family: string; operations: { type: string; family: string; description: string; schema: Record<string, unknown>; example: Record<string, unknown> }[] }[];
}

/** CLI 离线用的目录快照（`apps/cli/src/generated/catalog.json`，由 `tools/catalog-snapshot.ts` 生成）：`catalog.list` 的结果加操作目录。 */
export interface CatalogSnapshot extends CatalogListResult {
  editOps: CatalogEditOperations;
}

export interface CatalogListResult {
  /** 工具名与参数的合同版本，Agent 面三处（工具桥、MCP 服务、CLI）共用一个版本号（`MCP_INTERFACE_VERSION`）。 */
  interfaceVersion: string;
  tools: CatalogTool[];
}

export interface CatalogCallParams {
  name: string;
  /** 工具的参数（JSON），按工具的 schema 校验；不合时 `{ ok: false, error: { code: 'INVALID_ARGUMENTS' } }`。 */
  args: unknown;
  /** CLI 的工作目录（绝对路径）：相对路径（素材、导出目标、视频目录）按它解析，也从它向上找项目。 */
  cwd: string;
  /** 显式指定的项目目录（绝对路径，CLI 负责把 `--project` 按 cwd 解析好）；不给时从 `cwd` 向上找 `.bcut/project.json`。 */
  project?: string | null;
}

/** 工具的拒绝：与 MCP 工具结果里的 `error` 完全相同（`code` 是封闭的错误码，`next` / `remedy` / `retryability` 说怎么恢复）。 */
export interface CatalogToolError {
  code: string;
  message: string;
  [key: string]: unknown;
}

/** 调用的结果：工具的结果对象，或工具层的拒绝。网关层的拒绝（连接种类不对、参数形状不对）仍是 RPC 错误。 */
export type CatalogCallResult = { ok: true; result: unknown } | { ok: false; error: CatalogToolError };

/**
 * `catalog.agentSkill` 的结果：给外部 Agent 的说明书（`agent-skills/baocut/`，Agent 面设计 §8.6）按 CLI 面渲染好的全部文件，
 * `baocut skill install` 原样写进宿主的 skills 目录。
 */
export interface CatalogAgentSkill {
  interfaceVersion: string;
  /** skill 的 id，也是宿主 skills 目录里的目录名（`baocut`）。 */
  id: string;
  /** Runtime 读的来源目录（本机绝对路径）。 */
  sourceDir: string;
  /** 相对路径（`/` 分隔）与内容，按路径排序。 */
  files: { path: string; content: string }[];
}

/**
 * 工具名与参数名在 CLI 上的写法（Agent 面设计 §4.1）。CLI 的命令树与旗标、Runtime 给 CLI 渲染的 `next`、说明书的渲染器
 * （`agent-skill-renderer.ts`）与 craft 同步脚本共用这一份规则：
 *
 * - 工具名 `<名词>_<动词>` 是 `<名词> <动词>`，多词动词的 `_` 换成 `-`（`videos_import_package` → `videos import-package`）；
 *   没有 `_` 的是一级动词，两边同名（`transcribe`）。
 * - 字段名 `camelCase` 是旗标 `--kebab-case`（`documentId` → `--document-id`）。
 */
export interface ToolCommandName {
  /** 名词组；一级动词为 null。 */
  noun: string | null;
  verb: string;
  /** 命令行上的写法（不含 `baocut`）：`videos import-package`、`export`。 */
  display: string;
}

export function toolCommandName(name: string): ToolCommandName {
  const [head, ...rest] = name.split('_');
  if (rest.length === 0) return { noun: null, verb: head!, display: head! };
  const verb = rest.join('-');
  return { noun: head!, verb, display: `${head} ${verb}` };
}

/** 字段名 → 旗标名（不含 `--`）：`documentId` → `document-id`。 */
export function fieldFlagName(field: string): string {
  return field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * 一段文字里的工具名换成 CLI 命令（`videos_list` → `baocut videos list`）：只换 `names` 里带 `_` 的名字，按整词匹配；
 * 一级动词两边同名、又常是普通词，不动。
 */
export function renderCliToolNames(text: string, names: readonly string[]): string {
  const compound = names.filter((name) => name.includes('_')).sort((a, b) => b.length - a.length);
  if (compound.length === 0) return text;
  const pattern = new RegExp(`(?<![A-Za-z0-9_])(${compound.join('|')})(?![A-Za-z0-9_])`, 'g');
  return text.replace(pattern, (name) => `baocut ${toolCommandName(name).display}`);
}
