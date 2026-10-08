import { z } from 'zod';
import {
  RpcError,
  capabilityRemedyCommands,
  capabilitySettingsHref,
  isEngineErrorBody,
  localizeText,
  type CapabilityNotConfiguredDetails,
  type CatalogCliSwitch,
  type ToolEffect,
  type ToolSurface,
} from '@baocut/protocol';
import type { Logger } from '@baocut/harness';
import type { ToolPrincipal } from './tool-scope.ts';
import { OperationShapeError } from './video-digest.ts';
import { GRANT_NEXT, isGrantErrorDetails } from '../grants/grant-errors.ts';

/**
 * 工具目录（架构设计 §3.5）：MCP 端点背后的全部工具。各组工具（视频、模型）只给出参数 schema、说明与执行；
 * 解析参数、记日志、把错误换成智能体能据以行动的形态都在这里，各组一样。
 */

export interface ToolDefinition {
  name: string;
  title: string;
  /** 第一句是一行摘要（以句号结束，`--help` 与 MCP 列表只取它），后面才是细则。 */
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  /** 效果：`query` ⇔ `readOnlyHint`；`destructive` ⇒ `destructiveHint`；返回 `jobId` 的是 `job`。 */
  effect: ToolEffect;
  /** 一到三个最小调用示例，每个 `args` 都要通过工具自己的 schema。 */
  examples: ReadonlyArray<ToolExample>;
  /** 出现在哪些面（工具桥、MCP 服务、CLI），写全，不靠默认值。 */
  surfaces: ReadonlyArray<ToolSurface>;
  /** CLI 唯一的位置参数对应的字段名（通常是 `video`、`url` 或 `file`）。 */
  positional?: string;
  /** CLI 的快捷开关（`CatalogTool.cliSwitches`）：`--<flag>` 等于给 `field` 这个取值。 */
  cliSwitches?: ReadonlyArray<CatalogCliSwitch>;
}

export interface ToolExample {
  title: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export type ToolInfo = Omit<ToolDefinition, 'name' | 'inputSchema'>;

/** 一组工具。`dispatch` 收到的参数已经按 `schemas[name]` 解析过。 */
export interface ToolSet {
  readonly schemas: Readonly<Record<string, z.ZodType>>;
  readonly definitions: Readonly<Record<string, ToolInfo>>;
  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown>;
}

/**
 * 一份目录对某类主体的视图（§3.5、§4.8）：只露出 `surfaces` 含 `surface` 且 `expose` 认可的工具，看不到的与不存在的
 * 一样回答 `UNKNOWN_TOOL`；`describe` 改写个别工具的说明（对外的说明不提会话与工作目录）。
 */
export interface ToolCatalogView {
  surface?: ToolSurface;
  expose?: (name: string, info: ToolInfo) => boolean;
  describe?: (name: string, info: ToolInfo) => ToolInfo;
}

/** 工具层自己的拒绝：与引擎错误同一个形态，智能体按 `code` 决定下一步。 */
export class ToolError extends Error {
  readonly code: string;
  readonly extra: Record<string, unknown>;
  constructor(code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

/** 一次调用的结果：工具的结果对象，或给调用方的错误（`errorBody` 的形态）。 */
export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: ToolErrorBody };

export type ToolErrorBody = { code: string; message: string } & Record<string, unknown>;

export class ToolCatalog {
  readonly #sets: ToolSet[];
  readonly #log: Logger;
  readonly #parentLog: Logger;
  readonly #view: ToolCatalogView;

  constructor(sets: ToolSet[], log: Logger, view: ToolCatalogView = {}) {
    this.#sets = sets;
    this.#parentLog = log;
    this.#log = log.child('agent-tools');
    this.#view = view;
  }

  /** 同一组工具（同一份实现与范围）的另一个视图：给另一类主体用，不另建工具组。 */
  withView(view: ToolCatalogView): ToolCatalog {
    return new ToolCatalog(this.#sets, this.#parentLog, view);
  }

  list(): ToolDefinition[] {
    return this.#sets.flatMap((set) =>
      Object.keys(set.schemas)
        .filter((name) => this.#exposed(set, name))
        .map((name) => {
          const { $schema: _, ...inputSchema } = z.toJSONSchema(set.schemas[name]!, { io: 'input' }) as Record<string, unknown>;
          const info = set.definitions[name]!;
          return { name, ...(this.#view.describe ? this.#view.describe(name, info) : info), inputSchema };
        }),
    );
  }

  /** MCP 工具结果的形态：结果或错误写成一段 JSON 文本。 */
  async call(name: string, args: unknown, principal: ToolPrincipal): Promise<ToolResult> {
    const outcome = await this.invoke(name, args, principal);
    return outcome.ok
      ? { content: [{ type: 'text', text: JSON.stringify(outcome.result) }] }
      : { content: [{ type: 'text', text: JSON.stringify({ error: outcome.error }) }], isError: true };
  }

  /** 按名调用：解析参数、执行、记日志；错误换成 `errorBody` 的形态（`catalog.call` 原样交给 CLI）。 */
  async invoke(name: string, args: unknown, principal: ToolPrincipal): Promise<ToolOutcome> {
    const started = Date.now();
    try {
      const found = this.#sets.find((s) => Object.hasOwn(s.schemas, name));
      const set = found && this.#exposed(found, name) ? found : undefined;
      // i18n-ignore: 给模型的工具错误与下一步
      if (!set) throw new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`);
      const parsed = set.schemas[name]!.safeParse(args ?? {});
      if (!parsed.success) {
        // i18n-ignore: 给模型的工具错误与下一步
        throw new ToolError('INVALID_ARGUMENTS', '参数不对', {
          issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        });
      }
      const result = await set.dispatch(name, parsed.data, principal);
      this.#log.info('Tool call', { tool: name, ...callerOf(principal), ms: Date.now() - started });
      return { ok: true, result };
    } catch (error) {
      const body = this.#withInstallHint(errorBody(error));
      if (body.code === 'INTERNAL') this.#log.error('Tool call failed', { tool: name, error: String(error) });
      else this.#log.info('Tool call refused', { tool: name, ...callerOf(principal), code: body.code });
      return { ok: false, error: body };
    }
  }

  /** 本机模型没有安装、而这份目录里露出了 `models_install`（会话里的智能体）时：告诉它可以先下载模型（§6.3）。 */
  #withInstallHint<T extends { code: string } & Record<string, unknown>>(body: T): T {
    const remedy = body.remedy as { action?: string } | undefined;
    if (body.code !== 'CAPABILITY_NOT_CONFIGURED' || remedy?.action !== 'install-model') return body;
    if (!this.#sets.some((s) => Object.hasOwn(s.schemas, 'models_install') && this.#exposed(s, 'models_install'))) return body;
    return { ...body, next: INSTALL_MODEL_NEXT };
  }

  #exposed(set: ToolSet, name: string): boolean {
    const info = set.definitions[name];
    if (!info) return false;
    if (this.#view.surface && !info.surfaces.includes(this.#view.surface)) return false;
    return this.#view.expose ? this.#view.expose(name, info) : true;
  }
}

/** 日志里的调用方：会话、对外服务与客户端，或终端的连接。不含令牌。 */
function callerOf(principal: ToolPrincipal): Record<string, string> {
  if (principal.kind === 'agent') return { conversationId: principal.conversationId };
  if (principal.kind === 'local') return { client: principal.client, connectionId: principal.connectionId };
  return { serviceId: principal.serviceId, clientId: principal.clientId };
}

// i18n-ignore-start: 给模型的工具错误与下一步
/** 能力没有配置：智能体转告用户，不自己想办法绕过（§6.2）。 */
const NOT_CONFIGURED_NEXT =
  '这是用户需要在 BaoCut 里完成的配置，不是你能修好的问题：把 hint 与 commands 转告用户，请用户在设置里的模型配置中启用并配置服务，用 remedy.settingsHref 写成 Markdown 设置链接，链接文字用用户的语言说明对应能力（或在终端运行 commands 里的命令），然后再试。不要用 shell 命令、脚本、ffmpeg、别的网站或别的服务商绕过，也不要自己去找或填写 API key。';

/** 本机模型没有安装：可以把下载模型作为前置步骤提交（大小先告诉用户、按访问模式确认）。 */
const INSTALL_MODEL_NEXT =
  '本机模型包没有安装：可以用 models_install 下载它（工具会先把大小告诉用户并按访问模式确认；语音合成要给出 models_capabilities 里列出的合成模型包），用 jobs_wait 等它完成后再提交（合成带上 provider: local 与那个模型包）；也可以把 hint 与 commands 转告用户，请用户改用在线服务，用 remedy.settingsHref 写成 Markdown 设置链接。不要用 shell 命令、脚本或别的网站自己下载模型，也不要自己去找或填写 API key。';
// i18n-ignore-end

/** 错误给智能体的形态：`code` 决定下一步，`retryability` / `recovery` / `next` 说怎么恢复。 */
export function errorBody(error: unknown): ToolErrorBody {
  if (error instanceof ToolError) return { code: error.code, message: error.message, ...error.extra };
  if (error instanceof OperationShapeError) return { code: 'INVALID_OPERATION', message: error.message, operationIndex: error.index };
  if (error instanceof RpcError) {
    const details = error.details;
    if (isEngineErrorBody(details)) {
      return {
        code: details.code,
        message: localizeText(details.message, details.messageRef),
        retryability: details.retryability,
        ...(details.recovery ? { recovery: localizeText(details.recovery, details.recoveryRef) } : {}),
        ...(details.entityIds.length ? { entityIds: details.entityIds } : {}),
        ...(details.details !== null && details.details !== undefined ? { details: details.details } : {}),
        // i18n-ignore: 给模型的工具错误与下一步
        ...(details.code === 'PROJECT_REVISION_CONFLICT' ? { next: '用 videos_inspect 重新读取，按新的状态决定要不要改、怎么改' } : {}),
        ...(details.code === 'TASK_PROTECTED'
          ? {
              // i18n-ignore: 给模型的工具错误与下一步
              next: '这些内容在任务合同里受用户保护（tasks_contract 的 protectedRefs）：整笔修改没有写入。避开它们重新修改；确实要改时请用户调整保护范围，不要换别的办法绕过。',
            }
          : {}),
      };
    }
    if (isCapabilityNotConfigured(details)) {
      return {
        code: details.code,
        message: error.message,
        capability: details.capability,
        reason: details.reason,
        ...(details.providerId ? { providerId: details.providerId } : {}),
        remedy: {
          action: details.remedy.action, hint: details.remedy.hint, commands: capabilityRemedyCommands(details),
          settingsHref: capabilitySettingsHref(details.capability),
        },
        next: NOT_CONFIGURED_NEXT,
      };
    }
    // 授权与预算（§12.5、§7.8）：错误码、补救与下一步，不换服务商绕过。
    if (isGrantErrorDetails(details)) {
      const { code, ...rest } = details;
      return { code, message: error.message, ...rest, next: GRANT_NEXT[code] };
    }
    // 提交时按模型描述的检查（§6.2）：`details` 是模型的限制，原样交给智能体。
    const extra = isRecord(details) ? details : null;
    if (extra && typeof extra.limit === 'number' && typeof extra.length === 'number') {
      return {
        code: 'INPUT_TOO_LONG',
        message: error.message,
        details: extra,
        // i18n-ignore: 给模型的工具错误与下一步
        next: `输入有 ${extra.length} 个字符，模型单次最多 ${extra.limit} 个：自己按句子或段落切成每段不超过 ${extra.limit} 个字符，逐段提交（每段一个任务）。Runtime 不会替你截断或切分。`,
      };
    }
    // 没有指定音色而模型没有默认音色，或模型没有这个音色：从清单里选，或请用户给出账号里的音色 ID；不换服务商。
    const voiceNext =
      extra && Array.isArray(extra.voices)
        ? {
            next:
              (extra.voices as unknown[]).length > 0
                // i18n-ignore-start: 给模型的工具错误与下一步
                ? '从 details.voices 里选一个音色，或请用户给出服务商账号里的音色 ID；不要换服务商绕过。'
                : '这个模型的音色属于用户的服务商账号：请用户给出音色 ID（voice）；不要换服务商绕过。',
                // i18n-ignore-end
          }
        : {};
    return {
      code: error.code.toUpperCase().replace(/-/g, '_'),
      message: error.message,
      ...(extra ? { details: extra } : {}),
      ...voiceNext,
    };
  }
  // i18n-ignore: 给模型的工具错误与下一步
  return { code: 'INTERNAL', message: '工具内部出错' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCapabilityNotConfigured(value: unknown): value is CapabilityNotConfiguredDetails {
  return isRecord(value) && value.code === 'CAPABILITY_NOT_CONFIGURED';
}
