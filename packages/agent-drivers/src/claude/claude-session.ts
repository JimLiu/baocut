/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/claude/agent.ts 的 buildOptions（query 选项）、toSdkUserMessage（图片块）、
 * steerActiveTurn（priority:'next'）、interruptActiveTurn / discardQueuedSteers（中断前撤回没读到的追加消息）、
 * readMissingResumedConversationError（恢复不了的会话）、handlePermissionRequest（canUseTool 的挂起表；
 * ExitPlanMode 带出计划全文 `planText`）、normalizeClaudeAskUserQuestionRequestInput（AskUserQuestion 的输入形状，
 * BaoCut 不回答它，改为拒绝并让 Claude 用文字问）、CLAUDE_SETTING_SOURCES（加载设置层；BaoCut 只取 user 层）。
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import {
  agentModeLabel,
  newId,
  normalizeAgentMode,
  type AgentErrorCode,
  type AgentMode,
  type ApprovalRequest,
  type Autonomy,
  type Id,
} from '@baocut/protocol';
import { DriversClaude, DriversCommon } from '@baocut/protocol/messages/agent-drivers';
import {
  MCP_TOOL_CALL_TIMEOUT_MS,
  type AgentEvent,
  type AgentInput,
  type AgentPersistenceHandle,
  type AgentSession,
  type ApprovalResponse,
  type CreateSessionOptions,
  type InterruptReceipt,
  type Logger,
  type McpServerSpec,
  type TurnSettings,
} from '@baocut/harness';
import type {
  CanUseTool,
  EffortLevel,
  McpServerConfig,
  ModelInfo,
  Options,
  PermissionMode,
  PermissionResult,
  SDKAssistantMessageError,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { commandRule } from '../approval-rule.ts';
import { refField, textOf } from '../driver-text.ts';
import type { ClaudeInstall } from './claude-binary.ts';
import { ClaudeItemMapper, FILE_TOOLS, splitMcpTool, summarizeToolInput, toolFiles } from './claude-items.ts';
import { claudeAutoModeSupport, isClaudeEffort } from './claude-models.ts';
import { createMessageInput, sdkQueryFactory, type ClaudeQuery, type ClaudeQueryFactory, type MessageInput } from './claude-query.ts';

const CAPABILITIES = { steer: true, approvals: true, resume: true, images: true };

/** BaoCut 自己的 MCP 工具在原生侧一律放行，由 Runtime 的 ApprovalService 把关（见 `TurnSettings` 的说明）。 */
const BAOCUT_TOOLS = 'mcp__baocut__';

/**
 * Claude 向用户提问的工具。Driver ABI 的审批只有允许与拒绝，带不回用户的答案：当成审批放行的话 Claude 拿到的是原样的
 * 输入、没有答案。所以不弹审批卡，直接拒绝，让 Claude 把问题写进回复、结束本回合，用户的下一条消息就是回答。
 * 这句话是给模型看的，写成英文并要它用用户的语言提问，免得把回复带偏成某一种语言。
 */
const ASK_USER_QUESTION = 'AskUserQuestion';
export const ASK_USER_QUESTION_DENIAL =
  'AskUserQuestion is not available here: the user cannot see or answer it. Instead, write your question(s) to the user as plain text in your reply ' +
  '(list the options if there are any), in the language the user has been using, then end your turn and wait for their answer in the next message.';

/** 退出计划模式的工具：审批卡带上计划全文，不给「总是允许」，也不记会话级放行（每个计划都要用户看过）。 */
const EXIT_PLAN_MODE = 'ExitPlanMode';

/**
 * 访问模式 → Claude 的 permissionMode（架构设计 §3.12，对照表见 `TurnSettings`）。
 * `auto` 要模型支持（`supportsAutoMode`），不支持时退回 `default` 并提示。
 */
export function claudePermissionMode(mode: AgentMode | Autonomy): PermissionMode {
  switch (normalizeAgentMode(mode)) {
    case 'plan':
      return 'plan';
    case 'ask':
      return 'default';
    case 'autoAcceptEdits':
      return 'acceptEdits';
    case 'auto':
      return 'auto';
    case 'fullAccess':
      return 'bypassPermissions';
  }
}

/**
 * Claude Code 的设置层：会话与探测（`supportedModels()`）共用，两边看到的鉴权、模型设置一致。
 *
 * - 只加载 `user` 层（`$CLAUDE_CONFIG_DIR/settings.json`，默认 `~/.claude/settings.json`）：用户在那里配的 `env`
 *   （`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL`……）、`apiKeyHelper`、`model` 要生效。探测用的 `claude auth status`
 *   走的是 CLI 自己的全部设置，会话一层都不加载的话，靠这些设置鉴权的用户会探测为已登录、会话却鉴权失败。
 * - 不加载 `project` 与 `local`：两者都相对会话的 cwd（`.claude/settings.json`、`.claude/settings.local.json`），
 *   而 cwd 是视频的工作目录。那里的 hooks、权限规则、MCP 服务不是用户为 BaoCut 配的，可能随别人给的素材目录一起来；
 *   项目里的 CLAUDE.md 也因此不加载。
 * - user 层的权限规则与 hooks 会绕过 BaoCut 的审批（allow 规则命中时 CLI 不经 canUseTool，PreToolUse hook 可以直接放行），
 *   违反「Driver 侧不能比 BaoCut 的模式更宽」（架构设计 §3.12）。flag 层的 `disableAllHooks` 关掉非 managed 的 hooks；
 *   父进程给的 managed 层 `allowManagedPermissionRulesOnly` 让 user 层的权限规则不生效（`allowedTools` 也随之不生效，
 *   BaoCut 自己的工具另由 canUseTool 放行）。限制（未验证）：机器上已经有 IT 管理的 managed 设置时，SDK 默认丢弃父进程给的
 *   managed 层（管理员设了 `parentSettingsBehavior: 'merge'` 才合并），这时 user 层的 allow 规则照样生效。
 */
export function claudeSettingsOptions(): Pick<Options, 'settingSources' | 'settings' | 'managedSettings'> {
  // 每次给一份新的对象，不让几个 Query 共用。
  return {
    settingSources: ['user'],
    settings: { disableAllHooks: true },
    managedSettings: { allowManagedPermissionRulesOnly: true },
  };
}

/**
 * 原生错误 → 结构化的失败原因（架构设计 §3.11）。SDK 0.3.288 的 `SDKAssistantMessageError` 共 13 种：
 * 账号一类（未登录、组织不许用、账号冻结、要验证、云凭据失效）都要用户自己去处理登录，归 `AGENT_AUTH_REQUIRED`；
 * `invalid_request`、`server_error`、`unknown`、`max_output_tokens` 不是这几类，为 null，界面只显示原文。
 */
export function claudeErrorCode(error: SDKAssistantMessageError | null | undefined): AgentErrorCode | null {
  switch (error) {
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
    case 'account_on_hold':
    case 'verification_required':
    case 'cloud_credential_error':
      return 'AGENT_AUTH_REQUIRED';
    case 'billing_error':
      return 'AGENT_BILLING_REQUIRED';
    case 'model_not_found':
      return 'AGENT_MODEL_UNAVAILABLE';
    case 'rate_limit':
    case 'overloaded':
      return 'AGENT_RATE_LIMITED';
    default:
      return null;
  }
}

/** 启动就失败的结果（`startup_failure_reason`）里认得出的两种。 */
function startupErrorCode(reason: string | undefined): AgentErrorCode | null {
  if (reason === 'gateway_signin_required') return 'AGENT_AUTH_REQUIRED';
  if (reason === 'cli_version_too_old') return 'AGENT_OUTDATED';
  return null;
}

/**
 * McpServerSpec → SDK 的 Streamable HTTP 配置。headers 里有令牌：只交给 SDK，不进日志。
 * `timeout`：工具调用可能在等用户批准（见 `MCP_TOOL_CALL_TIMEOUT_MS`），不用 CLI 的默认值。
 */
export function claudeMcpServers(servers: Record<string, McpServerSpec>): Record<string, McpServerConfig> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, spec]) => [
      name,
      { type: 'http' as const, url: spec.url, headers: spec.headers, timeout: MCP_TOOL_CALL_TIMEOUT_MS },
    ]),
  );
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** 一条用户消息：图片读成 base64 的 image 块放在前面，文字放最后（斜杠命令只有在最后一个块里才会展开）。 */
export async function toClaudeUserMessage(input: AgentInput): Promise<SDKUserMessage> {
  const content: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } }> = [];
  for (const image of input.images ?? []) {
    const mediaType = image.mimeType === 'image/jpg' ? 'image/jpeg' : image.mimeType;
    if (!IMAGE_TYPES.has(mediaType)) throw new Error(String(DriversClaude.imageUnsupported({ mimeType: image.mimeType })));
    const data = (await fs.readFile(image.path)).toString('base64');
    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType as ImageMediaType, data } });
  }
  content.push({ type: 'text', text: input.text });
  return { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, uuid: randomUUID() };
}

interface Applied {
  mode: PermissionMode;
  model: string | null;
  effort: EffortLevel | null;
}

/** 一个运行中的 Query（一个 claude 进程）。强度变了、恢复失败时换一个新的。 */
interface LiveQuery {
  query: ClaudeQuery;
  input: MessageInput<SDKUserMessage>;
  applied: Applied;
  /** 起这个 Query 时请求恢复的原生会话 id。 */
  resume: string | null;
  /** 收到过 system/init：原生会话已经建立或恢复成功。 */
  initialized: boolean;
  /** 主动关掉的（重启、关闭会话）：它的结束不算进程意外退出。 */
  retired: boolean;
  models: Promise<ModelInfo[]> | null;
  stderr: string[];
}

interface Turn {
  id: string;
  message: SDKUserMessage;
  settings: TurnSettings;
  mapper: ClaudeItemMapper;
  /** 已请求中断（用户停止、或审批被 cancel）：结果到达时记为 interrupted。 */
  interrupting: boolean;
  errorCode: AgentErrorCode | null;
  errorText: string | null;
  /** 本回合追加（steer）的消息 uuid：中断时撤回 Claude 还没读到的。 */
  steers: string[];
  /** 恢复失败、已经在新会话里重发过这一轮。 */
  retriedFresh: boolean;
}

interface PendingApproval {
  turnId: string;
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  /** null：这一类不记会话级放行。 */
  grantKey: string | null;
  resolve: (result: PermissionResult) => void;
}

/**
 * Claude Code 会话：整个会话一个长驻的 SDK Query，输入是流式的 `AsyncIterable<SDKUserMessage>`（架构设计 §3.1）。
 *
 * Query 在第一轮才起：权限模式、模型、强度随 `startTurn` 才知道，强度又只能在起 Query 时给。
 * 每一轮先比对设置：模式变了 `setPermissionMode`，模型变了 `setModel`，强度变了带着恢复句柄重启 Query。
 */
export class ClaudeSession implements AgentSession {
  readonly id: Id = newId('ags');
  readonly capabilities = CAPABILITIES;

  readonly #install: ClaudeInstall;
  readonly #options: CreateSessionOptions;
  readonly #log: Logger;
  readonly #factory: ClaudeQueryFactory;
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  readonly #approvals = new Map<Id, PendingApproval>();
  /** 「本会话允许」与「总是允许」在原生侧都只记在这里：同类请求直接放行，不写 Claude 的任何设置文件。 */
  readonly #sessionGrants = new Set<string>();
  /** 已经提示过「不支持 auto」的模型，免得每一轮都提示。 */
  readonly #autoWarned = new Set<string>();

  #live: LiveQuery | null = null;
  /** 原生会话 id：恢复句柄给的，或 system/init 给的。下一个 Query 带着它恢复。 */
  #sessionId: string | null;
  #turn: Turn | null = null;
  #closed = false;

  constructor(install: ClaudeInstall, options: CreateSessionOptions, log: Logger, factory: ClaudeQueryFactory = sdkQueryFactory) {
    this.#install = install;
    this.#options = options;
    this.#log = log;
    this.#factory = factory;
    this.#sessionId = readSessionId(options.resume);
  }

  async startTurn(input: AgentInput, settings: TurnSettings): Promise<{ turnId: string }> {
    if (this.#closed) throw new Error(String(DriversCommon.sessionClosed({ name: 'Claude' })));
    if (this.#turn) throw new Error(String(DriversCommon.turnInProgress()));
    const message = await toClaudeUserMessage(input);
    const live = await this.#prepare(settings);
    const turnId = newId('turn');
    this.#turn = {
      id: turnId,
      message,
      settings,
      mapper: new ClaudeItemMapper(turnId, Date.now, this.#options.cwd),
      interrupting: false,
      errorCode: null,
      errorText: null,
      steers: [],
      retriedFresh: false,
    };
    this.#emit({ type: 'turn.started', turnId });
    live.input.push(message);
    return { turnId };
  }

  async steer(turnId: string, input: AgentInput): Promise<'accepted' | 'unavailable'> {
    const turn = this.#turn;
    if (!turn || turn.id !== turnId || turn.interrupting || !this.#live) return 'unavailable';
    const message = await toClaudeUserMessage(input);
    // 读图片的时候回合可能已经结束：结束了就不追加，免得它变成没人等的一轮。
    const live = this.#live;
    if (this.#turn !== turn || turn.interrupting || !live) return 'unavailable';
    message.priority = 'next';
    turn.steers.push(message.uuid!);
    // 用户发来了新的话：挂着的审批作废（按拒绝答复 Claude），由它按新的指示重新来。
    // i18n-ignore: 交给 Claude 的拒绝说明，给模型看
    this.#settleApprovals('用户发来了新的消息，这次操作没有执行。');
    live.input.push(message);
    return 'accepted';
  }

  async interrupt(turnId: string): Promise<InterruptReceipt> {
    const turn = this.#turn;
    const live = this.#live;
    if (!turn || turn.id !== turnId || !live) return { status: 'not-running' };
    turn.interrupting = true;
    turn.mapper.interrupting();
    // i18n-ignore: 交给 Claude 的拒绝说明，给模型看
    this.#settleApprovals('任务已停止。');
    await this.#discardSteers(live, turn);
    try {
      await withTimeout(live.query.interrupt(), 10_000, 'interrupt');
      return { status: 'requested' };
    } catch (error) {
      this.#log.warn('Claude interrupt request failed', { error: errorMessage(error) });
      return { status: 'unknown' };
    }
  }

  async respondToApproval(approvalId: Id, response: ApprovalResponse): Promise<void> {
    const pending = this.#approvals.get(approvalId);
    if (!pending) return;
    this.#approvals.delete(approvalId);
    switch (response.decision) {
      case 'accept-for-session':
      case 'accept-always':
        // 「总是允许」的规则归 Harness 存；这里只按会话级放行处理，绝不回传 updatedPermissions（那会写进 Claude 的设置文件）。
        if (pending.grantKey) this.#sessionGrants.add(pending.grantKey);
        pending.resolve({ behavior: 'allow', updatedInput: pending.input });
        this.#afterAllowed(pending);
        return;
      case 'accept':
        pending.resolve({ behavior: 'allow', updatedInput: pending.input });
        this.#afterAllowed(pending);
        return;
      case 'decline':
        this.#turn?.mapper.declined(pending.toolUseId);
        // i18n-ignore: 交给 Claude 的拒绝说明，给模型看
        pending.resolve({ behavior: 'deny', message: '用户拒绝了这次操作。' });
        return;
      case 'cancel': {
        // 停止屏障（D04）：拒绝并结束本回合。
        const turn = this.#turn;
        if (turn && turn.id === pending.turnId) {
          turn.interrupting = true;
          turn.mapper.interrupting();
        }
        // i18n-ignore: 交给 Claude 的拒绝说明，给模型看
        pending.resolve({ behavior: 'deny', message: '任务已停止。', interrupt: true });
        return;
      }
    }
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  describePersistence(): AgentPersistenceHandle | null {
    return this.#sessionId ? { driverId: 'claude', data: { sessionId: this.#sessionId } } : null;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    // i18n-ignore: 交给 Claude 的拒绝说明，给模型看
    this.#settleApprovals('会话已关闭。');
    const live = this.#live;
    this.#live = null;
    if (live) this.#retire(live);
    this.#emit({ type: 'session.exited', error: null });
  }

  // ---- Query 的建立、比对与重启 ----

  /** 按这一轮的设置备好 Query：没有就起，强度变了就重启，再对齐模型与权限模式。 */
  async #prepare(settings: TurnSettings): Promise<LiveQuery> {
    const effort = this.#effort(settings.effort);
    let live = this.#live;
    if (live && live.applied.effort !== effort) {
      // 强度只能在起 Query 时给：带着恢复句柄重启（driver.ts 的约定）。2.1.x 的 `applyFlagSettings({ effortLevel })`
      // 可以不重启就改，没有采用：它是 flag 设置层，和用户自己的设置怎么叠加没有核实。
      this.#log.info('Claude effort changed; restarting the Query with the resume handle', { from: live.applied.effort, to: effort });
      this.#retire(live);
      this.#live = null;
      live = null;
    }
    live ??= this.#start(settings, effort);
    await this.#reconcile(live, settings);
    return live;
  }

  #start(settings: TurnSettings, effort: EffortLevel | null): LiveQuery {
    const confined = this.#options.confinement === 'cwd-write-only';
    // auto 先按 default 起：要等 Query 起来才能问模型支不支持，第一轮的比对里再切过去。
    const mode = confined ? 'acceptEdits' : settings.accessMode === 'auto' ? 'default' : claudePermissionMode(settings.accessMode);
    const input = createMessageInput<SDKUserMessage>();
    const resume = this.#sessionId;
    const live: LiveQuery = {
      query: null as unknown as ClaudeQuery,
      input,
      applied: { mode, model: settings.model, effort },
      resume,
      initialized: false,
      retired: false,
      models: null,
      stderr: [],
    };
    const options = this.#queryOptions(live, mode, settings.model, effort, resume, confined);
    live.query = this.#factory({ prompt: input.iterable, options });
    this.#live = live;
    void this.#pump(live);
    return live;
  }

  #queryOptions(
    live: LiveQuery,
    mode: PermissionMode,
    model: string | null,
    effort: EffortLevel | null,
    resume: string | null,
    confined: boolean,
  ): Options {
    const options: Options = {
      // 用用户自己装的 claude，不用 SDK 自带的平台二进制。
      pathToClaudeCodeExecutable: this.#install.command,
      // install.env 就是 agentEnv() 的结果：登录 shell 的环境（当前进程的优先），去掉宿主 Claude Code 会话的变量（CLAUDECODE 等）。
      // SDK 用它整个替换子进程的环境，再自己补上 CLAUDE_CODE_ENTRYPOINT 之类。
      env: this.#install.env,
      cwd: this.#options.cwd,
      // 只加载 user 层，关掉 hooks 与 user 层的权限规则（见 claudeSettingsOptions）。
      ...claudeSettingsOptions(),
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        ...(this.#options.developerInstructions ? { append: this.#options.developerInstructions } : {}),
      },
      permissionMode: mode,
      // 只是允许以后切到 bypassPermissions（「完全访问」）；生效的模式仍由 permissionMode 定。不设的话会话中途切不过去。
      // 常开。未验证：default 模式下它确实不改变询问行为；以 root 运行等环境下 CLI 会不会因它拒绝启动。
      allowDangerouslySkipPermissions: !confined,
      canUseTool: this.#canUseTool,
      includePartialMessages: true,
      stderr: (data) => {
        live.stderr.push(data);
        if (live.stderr.length > 20) live.stderr.shift();
      },
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(resume ? { resume } : {}),
    };
    // 受限的一次性调用按 §6.9「不给 MCP 服务，没有 BaoCut 的工具」：调用方即使传了也不接。
    if (this.#options.mcpServers && !confined) {
      options.mcpServers = claudeMcpServers(this.#options.mcpServers);
      options.allowedTools = [`${BAOCUT_TOOLS}*`];
    }
    if (confined) {
      // 受限的一次性调用（§6.9）：Claude Code 没有与 Codex workspace-write 完全对应的沙箱。近似做法：
      // 文件修改由 acceptEdits 放行（只限工作目录，越界的会来问），命令进 Claude Code 自带的沙箱、不准逃出沙箱，
      // 所有要问的都由 canUseTool 直接拒绝（没有人来批）。系统临时目录是否可写、网络是否全断取决于沙箱默认值——未验证。
      options.sandbox = { enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false };
    }
    return options;
  }

  /** 让后续消息不再进这个 Query，结束它的输入并关掉进程。 */
  #retire(live: LiveQuery): void {
    live.retired = true;
    live.input.end();
    try {
      live.query.close();
    } catch (error) {
      this.#log.debug('Closing the Claude Query failed', { error: errorMessage(error) });
    }
  }

  async #reconcile(live: LiveQuery, settings: TurnSettings): Promise<void> {
    if (live.applied.model !== settings.model) {
      try {
        await withTimeout(live.query.setModel(settings.model ?? undefined), 15_000, 'setModel');
      } catch (error) {
        const model = settings.model ?? DriversClaude.defaultModel();
        throw Object.assign(new Error(String(DriversClaude.switchModelFailed({ model, error: errorMessage(error) }))), {
          agentCode: 'AGENT_MODEL_UNAVAILABLE',
        });
      }
      live.applied.model = settings.model;
    }
    if (this.#options.confinement === 'cwd-write-only') return;
    const mode = await this.#resolveMode(live, settings);
    if (live.applied.mode === mode) return;
    try {
      await withTimeout(live.query.setPermissionMode(mode), 15_000, 'setPermissionMode');
      live.applied.mode = mode;
    } catch (error) {
      if (mode !== 'auto') throw error;
      this.#warnAutoUnsupported(settings.model, errorMessage(error));
      if (live.applied.mode !== 'default') {
        await withTimeout(live.query.setPermissionMode('default'), 15_000, 'setPermissionMode');
        live.applied.mode = 'default';
      }
    }
  }

  async #resolveMode(live: LiveQuery, settings: TurnSettings): Promise<PermissionMode> {
    const mode = claudePermissionMode(settings.accessMode);
    if (mode !== 'auto') return mode;
    live.models ??= withTimeout(live.query.supportedModels(), 15_000, 'supportedModels').catch(() => []);
    if (claudeAutoModeSupport(await live.models, settings.model) === false) {
      this.#warnAutoUnsupported(settings.model, null);
      return 'default';
    }
    return 'auto';
  }

  #warnAutoUnsupported(model: string | null, reason: string | null): void {
    const key = model ?? 'default';
    if (this.#autoWarned.has(key)) return;
    this.#autoWarned.add(key);
    const message = DriversClaude.autoUnsupported({ model: model ?? '', reason: reason ?? '' });
    this.#emit({ type: 'session.warning', message: String(message), ...refField('messageRef', message) });
  }

  #effort(effort: string | null): EffortLevel | null {
    if (!effort) return null;
    if (isClaudeEffort(effort)) return effort;
    this.#log.warn("Claude doesn't recognize this effort level; using the default", { effort });
    return null;
  }

  // ---- 消息流 ----

  async #pump(live: LiveQuery): Promise<void> {
    let failure: unknown = null;
    try {
      for await (const message of live.query) {
        if (live.retired || this.#live !== live) continue;
        this.#onMessage(live, message);
      }
    } catch (error) {
      failure = error;
    }
    if (live.retired || this.#live !== live) return;
    const turn = this.#turn;
    if (turn && !live.initialized && live.resume && !turn.retriedFresh) {
      // 带着恢复句柄起的进程还没建立会话就没了：多半是原生会话恢复不了，换新会话重发这一轮（未验证：没有真实复现过）。
      void this.#retryFresh(turn, failure ? errorMessage(failure) : lastLine(live.stderr));
      return;
    }
    // 进程没了，会话随之结束（Harness 收到 session.exited 就放下它）；之后的 close() 不再重复发 session.exited。
    this.#closed = true;
    this.#live = null;
    this.#turn = null;
    // i18n-ignore: 交给 Claude 的拒绝说明，给模型看
    this.#settleApprovals('Claude Code 进程已退出。');
    const reason = failure ? errorMessage(failure) : lastLine(live.stderr);
    this.#log.warn('Claude Code process exited', { error: reason });
    this.#emit({ type: 'session.exited', error: reason || null });
  }

  #onMessage(live: LiveQuery, message: SDKMessage): void {
    if ('session_id' in message && typeof message.session_id === 'string' && message.session_id && !this.#sessionId) {
      this.#sessionId = message.session_id;
    }
    if (message.type === 'system') {
      if (message.subtype === 'init') {
        live.initialized = true;
        if (live.resume && message.session_id !== live.resume) {
          // 未验证：恢复成功时 Claude Code 沿用原来的会话 id。对不上时以 CLI 给的为准。
          this.#log.info('Claude resumed session id differs from the handle', { requested: live.resume, actual: message.session_id });
        }
        this.#sessionId = message.session_id;
      } else if (message.subtype === 'status' && message.permissionMode) {
        // CLI 自己改了模式（批准 ExitPlanMode 后退出计划模式、Claude 调 EnterPlanMode 进入）：记下来，下一轮的比对按
        // 会话此刻的访问模式改回去。这是有意的：访问模式归 Harness 管（§3.12 两边取更严），会话仍是「先给方案」时，
        // 原生侧回到 plan 才和 Harness 的查表一致；用户改了访问模式，下一轮就按新的档位切过去。
        live.applied.mode = message.permissionMode;
      } else if (message.subtype === 'api_retry') {
        const text = DriversClaude.apiRetry({ error: message.error, attempt: message.attempt, max: message.max_retries });
        this.#emit({
          type: 'session.error',
          turnId: this.#turn?.id ?? null,
          message: String(text),
          ...refField('messageRef', text),
          willRetry: true,
          code: claudeErrorCode(message.error),
        });
      }
      return;
    }
    const turn = this.#turn;
    if (!turn) {
      this.#log.debug('Ignoring Claude message outside a turn', { type: message.type });
      return;
    }
    if (message.type === 'result') {
      this.#onResult(live, turn, message);
      return;
    }
    if (message.type === 'assistant' && message.error && !message.parent_tool_use_id) {
      turn.errorCode ??= claudeErrorCode(message.error);
      turn.errorText ??= assistantText(message.message.content as unknown) || message.error;
    }
    for (const event of turn.mapper.map(message)) this.#emit(event);
  }

  #onResult(live: LiveQuery, turn: Turn, result: Extract<SDKMessage, { type: 'result' }>): void {
    const errors = result.subtype === 'success' ? [] : result.errors;
    if (live.resume && !turn.retriedFresh && errors.some((e) => /^No conversation found with session ID/.test(e))) {
      // 原生会话恢复不了（按错误原文识别；未验证：没有真实复现过）。
      void this.#retryFresh(turn, errors.join('\n'));
      return;
    }
    // 追加的消息没赶上这一轮、作为下一轮排着（queued_turn_count > 0）：BaoCut 的回合等它们跑完再结束。
    if (!turn.interrupting && (result.queued_turn_count ?? 0) > 0) return;
    const aborted = result.terminal_reason === 'aborted_streaming' || result.terminal_reason === 'aborted_tools';
    const failed = result.is_error || result.subtype !== 'success' || turn.errorCode !== null;
    const outcome = turn.interrupting || aborted ? 'interrupted' : failed ? 'failed' : 'completed';
    const error =
      outcome === 'failed'
        ? turn.errorText ?? (errors.join('\n') || (result.subtype === 'success' ? result.result : '') || DriversClaude.turnFailed({ subtype: result.subtype }))
        : null;
    const errorCode = outcome === 'failed' ? (turn.errorCode ?? startupErrorCode(result.subtype === 'success' ? undefined : result.startup_failure_reason)) : null;
    // i18n-ignore: 交给 Claude 的拒绝说明，给模型看
    this.#settleApprovals('回合已结束。');
    this.#turn = null;
    this.#emit({ type: 'turn.completed', turnId: turn.id, outcome, error: textOf(error), ...refField('errorRef', error), errorCode });
  }

  /** 原生会话恢复不了：丢掉句柄，在新会话里重发这一轮，并如实告知（架构设计 §2.5）。 */
  async #retryFresh(turn: Turn, reason: string): Promise<void> {
    this.#log.warn('Claude session resume failed; starting a new one', { error: reason });
    const old = this.#live;
    if (old) this.#retire(old);
    this.#live = null;
    this.#sessionId = null;
    turn.retriedFresh = true;
    const warning = DriversCommon.resumeFailed({ name: 'Claude Code', error: reason });
    this.#emit({ type: 'session.warning', message: String(warning), ...refField('messageRef', warning) });
    try {
      const live = this.#start(turn.settings, this.#effort(turn.settings.effort));
      await this.#reconcile(live, turn.settings);
      if (this.#turn === turn) live.input.push(turn.message);
    } catch (error) {
      if (this.#turn !== turn) return;
      this.#turn = null;
      this.#emit({ type: 'turn.completed', turnId: turn.id, outcome: 'failed', error: errorMessage(error), errorCode: null });
    }
  }

  // ---- 审批 ----

  readonly #canUseTool: CanUseTool = (toolName, input, options) => {
    if (toolName.startsWith(BAOCUT_TOOLS)) return Promise.resolve({ behavior: 'allow', updatedInput: input });
    if (toolName === ASK_USER_QUESTION) {
      // 不弹审批卡（见 ASK_USER_QUESTION）。时间线上这一步记为「已拒绝」而不是「失败」。
      // 未验证：bypassPermissions 与 auto 模式下 CLI 是否仍经 canUseTool 问这个工具（auto 可能交给分类器）；不经过时它照原生行为执行。
      this.#turn?.mapper.declined(options.toolUseID);
      return Promise.resolve({ behavior: 'deny', message: ASK_USER_QUESTION_DENIAL });
    }
    if (this.#options.confinement === 'cwd-write-only') {
      // i18n-ignore: 交给 Claude 的拒绝说明，给模型看
      return Promise.resolve({ behavior: 'deny', message: '这次调用不允许越过工作目录或访问网络。' });
    }
    const turn = this.#turn;
    if (this.#closed || !turn || turn.interrupting || options.signal.aborted) {
      // i18n-ignore: 交给 Claude 的拒绝说明，给模型看
      return Promise.resolve({ behavior: 'deny', message: '任务已停止。' });
    }
    const { request, grantKey } = approvalRequest(toolName, input, options, this.#options.cwd);
    if (grantKey && this.#sessionGrants.has(grantKey)) return Promise.resolve({ behavior: 'allow', updatedInput: input });

    return new Promise<PermissionResult>((resolve) => {
      const approvalId = newId('appr');
      this.#approvals.set(approvalId, { turnId: turn.id, toolName, toolUseId: options.toolUseID, input, grantKey, resolve });
      options.signal.addEventListener(
        'abort',
        () => {
          // Claude 那边撤回了这次请求（回合被中断等）：收起待批卡片。
          if (!this.#approvals.delete(approvalId)) return;
          this.#emit({ type: 'approval.resolved', approvalId });
          // i18n-ignore: 交给 Claude 的拒绝说明，给模型看
          resolve({ behavior: 'deny', message: '请求已撤回。' });
        },
        { once: true },
      );
      this.#emit({ type: 'approval.requested', turnId: turn.id, approvalId, request });
    });
  };

  /**
   * 允许之后的提示。批准 ExitPlanMode 后 CLI 退出计划模式、开始按方案修改；而 BaoCut 会话的访问模式还是「先给方案」时，
   * Harness 会按 §3.12 拒绝这些修改，Claude 收到的只是「用户拒绝了」（Driver 分不出是模式自动拒绝的还是用户点的）。
   * Driver ABI 改不了会话的访问模式，只能提示用户自己切换；切了之后，本回合余下的审批按新模式查表，下一轮原生侧也跟着切。
   */
  #afterAllowed(pending: PendingApproval): void {
    if (pending.toolName !== EXIT_PLAN_MODE) return;
    const turn = this.#turn;
    if (!turn || turn.id !== pending.turnId || normalizeAgentMode(turn.settings.accessMode) !== 'plan') return;
    const message = DriversClaude.exitedPlanMode({ plan: agentModeLabel('plan'), edit: agentModeLabel('autoAcceptEdits') });
    this.#emit({ type: 'session.warning', message: String(message), ...refField('messageRef', message) });
  }

  /** 结清所有挂着的审批：按拒绝答复 Claude，并让界面收起待批卡片。 */
  #settleApprovals(message: string): void {
    for (const [approvalId, pending] of [...this.#approvals]) {
      this.#approvals.delete(approvalId);
      pending.resolve({ behavior: 'deny', message });
      this.#emit({ type: 'approval.resolved', approvalId });
    }
  }

  /**
   * 中断时撤回 Claude 还没读到的追加消息，否则它们会在中断之后照样跑一轮。SDK 运行时有 `cancelAsyncMessage`，
   * 公开的 `Query` 类型还没有；没有就跳过（未验证：没有真实复现过撤回）。
   */
  async #discardSteers(live: LiveQuery, turn: Turn): Promise<void> {
    const cancel = (live.query as ClaudeQuery & { cancelAsyncMessage?: (uuid: string) => Promise<boolean> }).cancelAsyncMessage;
    const uuids = turn.steers.splice(0);
    if (!cancel) return;
    for (const uuid of uuids) {
      try {
        await withTimeout(cancel.call(live.query, uuid), 5_000, 'cancelAsyncMessage');
      } catch (error) {
        this.#log.debug('Withdrawing a queued message failed', { error: errorMessage(error) });
      }
    }
  }

  #emit(event: AgentEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        this.#log.error('AgentEvent listener failed', { error: String(error) });
      }
    }
  }
}

/**
 * canUseTool 的请求 → BaoCut 的审批请求，以及「本会话允许」的记忆键：
 * 命令按 `commandRule`（同一个命令名与子命令算同类），文件修改不分工具算一类，其他工具按工具名。
 */
export function approvalRequest(
  toolName: string,
  input: Record<string, unknown>,
  options: Parameters<CanUseTool>[2],
  cwd: string,
): { request: ApprovalRequest; grantKey: string | null } {
  const reason = options.decisionReason ?? null;
  if (toolName === EXIT_PLAN_MODE) {
    // 审批卡的 `reason` 放计划全文（时间线上那一步的 detail 也是全文，见 claude-items.ts）。不给「总是允许」，不记会话级放行。
    const plan = typeof input.plan === 'string' && input.plan.trim() ? input.plan.trim() : null;
    return { request: { kind: 'tool', tool: toolName, server: null, reason: plan ?? reason, files: [], rule: null }, grantKey: null };
  }
  if (toolName === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : '';
    const rule = commandRule(command);
    const description = typeof input.description === 'string' && input.description.trim() ? input.description : null;
    return {
      request: { kind: 'command', command, cwd, reason: description ?? reason, rule },
      grantKey: `command:${rule ?? command}`,
    };
  }
  if (FILE_TOOLS.has(toolName)) {
    const files = toolFiles(input);
    if (options.blockedPath && !files.includes(options.blockedPath)) files.push(options.blockedPath);
    return { request: { kind: 'file-change', reason, files, rule: null }, grantKey: 'file-change' };
  }
  // 审批请求只有一个 `reason`：参数摘要在前，Claude 给的理由（有时）接在后面。
  const mcp = splitMcpTool(toolName);
  const summary = summarizeToolInput(toolName, input);
  return {
    request: {
      kind: 'tool',
      tool: mcp?.tool ?? toolName,
      server: mcp?.server ?? null,
      reason: reason ? `${summary} · ${reason}` : summary,
      files: toolFiles(input),
      rule: toolName,
    },
    grantKey: `tool:${toolName}`,
  };
}

function readSessionId(handle: AgentPersistenceHandle | null): string | null {
  if (!handle || handle.driverId !== 'claude') return null;
  const data = handle.data as { sessionId?: unknown } | null;
  return typeof data?.sessionId === 'string' && data.sessionId ? data.sessionId : null;
}

function assistantText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return (content as Array<{ type: string; text?: unknown }>)
    .map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .join('')
    .trim();
}

function lastLine(lines: string[]): string {
  return lines.join('').trim().split('\n').filter(Boolean).pop()?.trim() ?? '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(String(DriversCommon.timedOut({ label, seconds: ms / 1000 })))), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
