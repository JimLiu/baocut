/**
 * Codex 会话（`codex app-server` 的机器协议）。
 *
 * `steer` 判定「确定没送进去」的那几种拒绝（`isDefinitiveSteerRejection`）移植自 paseo 的
 * packages/server/src/server/agent/providers/codex-app-server-agent.ts（`isDefinitiveCodexSteerRejection`、
 * `steerActiveTurn`），Apache-2.0，Copyright (c) 2025-present Mohamed Boudra；modified：
 * 改成 BaoCut 的 `'accepted' | 'unavailable'` 返回值，并按 BaoCut 自己记的活动回合先判一次。
 */
import { spawn } from 'node:child_process';
import {
  RUNTIME_VERSION,
  newId,
  normalizeAgentMode,
  type AgentErrorCode,
  type AgentMode,
  type Autonomy,
  type DriverProbe,
  type Id,
} from '@baocut/protocol';
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
import type { CodexInstall } from './codex-binary.ts';
import type {
  ApprovalsReviewer,
  AskForApproval,
  CodexApprovalDecision,
  CodexMcpServer,
  CodexThreadItem,
  CodexTurn,
  CodexTurnError,
  CodexUserInput,
  CommandApprovalParams,
  FileChangeApprovalParams,
  InitializeParams,
  SandboxMode,
  SandboxPolicy,
  SandboxWorkspaceWrite,
  ThreadResumeParams,
  ThreadStartParams,
  ThreadStartResponse,
  TurnStartParams,
  TurnStartResponse,
  TurnSteerParams,
  TurnSteerResponse,
} from './codex-protocol.ts';
import { DriversCodex, DriversCommon } from '@baocut/protocol/messages/agent-drivers';
import { commandRule } from '../approval-rule.ts';
import { errorRefField, refField, textOf, type DriverText } from '../driver-text.ts';
import { classifyCodexError } from './codex-error.ts';
import { mapCodexItem } from './map-item.ts';
import { CodexRpcConnection, CodexRpcError, NO_RESPONSE, type RpcId } from './rpc-connection.ts';

/** Codex 会话实际支持的能力：steer 走 `turn/steer`，图片走 `localImage`。 */
export const CODEX_CAPABILITIES: DriverProbe['capabilities'] = { steer: true, approvals: true, resume: true, images: true };

/**
 * 访问模式 → Codex 的审批策略、审批人与沙箱（架构设计 §3.12）。两边不一致时取更严的一方：Codex 来问的动作再由
 * Harness 按 BaoCut 的决策表决定自动、询问或拒绝；Codex 不来问的动作（沙箱内直接执行的）BaoCut 无从拦截，
 * 所以 Codex 侧的策略不能比 BaoCut 的模式更宽。旧值先换成新值。
 *
 * | 模式 | approvalPolicy | sandbox | 说明 |
 * | --- | --- | --- | --- |
 * | plan | untrusted | read-only | 只读沙箱，不可信的命令都来问 |
 * | ask | untrusted | workspace-write | 命令与文件修改都来问，交给用户 |
 * | autoAcceptEdits | untrusted | workspace-write | 都来问；工作目录内的文件修改由 Harness 自动接受 |
 * | auto | on-request | workspace-write | 沙箱内直接执行；越出沙箱时来问（算 `high`，交给用户） |
 * | fullAccess | never | workspace-write | 不来问；沙箱仍然生效 |
 *
 * 审批人一律显式给 `user`：用户的 config.toml 若把审批人设成 auto_review，Codex 来问的动作就绕过了 BaoCut 的决策表。
 * 会话中途换模式时，下一轮在 `turn/start` 上带新的策略；沙箱变了（进出「先给方案」）才另带 `sandboxPolicy`。
 */
export function codexPolicy(mode: AgentMode | Autonomy): { approvalPolicy: AskForApproval; approvalsReviewer: ApprovalsReviewer; sandbox: SandboxMode } {
  switch (normalizeAgentMode(mode)) {
    case 'plan':
      return { approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: 'read-only' };
    case 'ask':
    case 'autoAcceptEdits':
      return { approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: 'workspace-write' };
    case 'auto':
      return { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' };
    case 'fullAccess':
      return { approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'workspace-write' };
  }
}

/**
 * BaoCut 工具调用的时限（秒，`mcp_servers.<name>.tool_timeout_sec`）。会话审批没有时限，用户可能过很久才处理；
 * Codex 默认 60 秒就放弃一次工具调用，所以按 `MCP_TOOL_CALL_TIMEOUT_MS` 放宽到一天。
 */
export const CODEX_TOOL_TIMEOUT_SEC = MCP_TOOL_CALL_TIMEOUT_MS / 1000;

/**
 * BaoCut 的输入 → Codex 的 `UserInput`：文字在前，图片（已经落在本机）按 `localImage` 给路径，由 Codex 自己读。
 * 只有图片、没有文字时不发空的文字段。
 */
export function codexUserInput(input: AgentInput): CodexUserInput[] {
  const images = (input.images ?? []).map((image): CodexUserInput => ({ type: 'localImage', path: image.path }));
  const text: CodexUserInput[] = input.text || images.length === 0 ? [{ type: 'text', text: input.text, text_elements: [] }] : [];
  return [...text, ...images];
}

/**
 * 每一轮带上的沙箱（`turn/start` 的 `sandboxPolicy`）。只在沙箱和线程当前的不同时才带：`workspaceWrite` 按 Codex 的缺省细项
 * （额外可写目录为空、不联网、照旧可写 `/tmp` 与 `$TMPDIR`），带了就盖过用户 config.toml 里的 `sandbox_workspace_write`。
 */
export function codexSandboxPolicy(sandbox: SandboxMode): SandboxPolicy {
  switch (sandbox) {
    case 'read-only':
      return { type: 'readOnly', networkAccess: false };
    case 'workspace-write':
      return { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
    case 'danger-full-access':
      return { type: 'dangerFullAccess' };
  }
}

/**
 * 受限的一次性调用（`confinement: 'cwd-write-only'`，架构设计 §6.9）：沙箱只允许写工作目录，去掉默认可写的 `/tmp` 与
 * `$TMPDIR`，命令不联网；审批策略 `never`：越界的动作不会来问，直接失败。
 */
const CONFINED_POLICY: { approvalPolicy: AskForApproval; sandbox: SandboxMode } = { approvalPolicy: 'never', sandbox: 'workspace-write' };
const CONFINED_WORKSPACE_WRITE: SandboxWorkspaceWrite = {
  writable_roots: [],
  network_access: false,
  exclude_tmpdir_env_var: true,
  exclude_slash_tmp: true,
};

interface PendingApproval {
  rpcId: RpcId;
  settle: (decision: CodexApprovalDecision) => void;
  abandon: () => void;
}

/** 「总是允许」的规则归 Harness 存，原生侧只按会话级放行处理（见 `ApprovalResponse`）。 */
const DECISION: Record<ApprovalResponse['decision'], CodexApprovalDecision> = {
  accept: 'accept',
  'accept-for-session': 'acceptForSession',
  'accept-always': 'acceptForSession',
  decline: 'decline',
  cancel: 'cancel',
};

/** 回合内不再重试的错误：Codex 随后的 `turn/completed`（failed）带同一个错误，所以先记下，等回合结束时一起报。 */
interface TurnFailure {
  /** Codex 给的原话；没有时是 BaoCut 写的「未知错误」。 */
  message: DriverText;
  code: AgentErrorCode | null;
}

export class CodexSession implements AgentSession {
  readonly id: Id = newId('ags');
  readonly capabilities = CODEX_CAPABILITIES;

  readonly #conn: CodexRpcConnection;
  readonly #log: Logger;
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  readonly #approvals = new Map<Id, PendingApproval>();
  readonly #approvalByRpc = new Map<string, Id>();
  readonly #fileChanges = new Map<string, string[]>();
  #threadId: string | null = null;
  #confined = false;
  /** 线程当前的沙箱：换模式进出「先给方案」时，下一轮的 `turn/start` 才带 `sandboxPolicy`。 */
  #sandbox: SandboxMode = 'workspace-write';
  /** `on-request` 下 Codex 只为越出沙箱来问：报给 Harness 时标为越界（§3.12）。随每一轮的访问模式更新。 */
  #escalationOnly = false;
  /** 正在跑的回合：`turn/start` 应答或 `turn/started` 时记下，`turn/completed` 时清掉。steer 只投给它。 */
  #activeTurnId: string | null = null;
  #lastCompletedTurnId: string | null = null;
  readonly #turnFailures = new Map<string, TurnFailure>();

  private constructor(conn: CodexRpcConnection, log: Logger) {
    this.#conn = conn;
    this.#log = log;
  }

  static async start(install: CodexInstall, options: CreateSessionOptions, log: Logger): Promise<CodexSession> {
    const child = spawn(install.command, ['app-server'], {
      cwd: options.cwd,
      env: install.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const session = new CodexSession(new CodexRpcConnection(child, log), log);
    try {
      await session.#initialize(options);
      return session;
    } catch (error) {
      await session.#conn.close();
      throw error;
    }
  }

  async #initialize(options: CreateSessionOptions): Promise<void> {
    const conn = this.#conn;
    conn.onNotification((method, params) => this.#onNotification(method, params));
    conn.onExit((error) => {
      this.#activeTurnId = null;
      // 报过错、却没等到 turn/completed 进程就退了：把记下的错误报出来，别吞掉。
      for (const [turnId, failure] of this.#turnFailures) {
        this.#emit({
          type: 'session.error',
          turnId,
          message: textOf(failure.message),
          ...refField('messageRef', failure.message),
          willRetry: false,
          code: failure.code,
        });
      }
      this.#turnFailures.clear();
      for (const pending of this.#approvals.values()) pending.abandon();
      this.#approvals.clear();
      this.#emit({ type: 'session.exited', error: error ? error.message : null, ...errorRefField('errorRef', error) });
    });
    conn.handle('item/commandExecution/requestApproval', (params, rpcId) => {
      const p = params as CommandApprovalParams;
      return this.#askApproval(rpcId, p.turnId, {
        kind: 'command',
        command: p.command ?? '',
        cwd: p.cwd ?? null,
        reason: p.reason ?? null,
        rule: commandRule(p.command ?? ''),
      });
    });
    conn.handle('item/fileChange/requestApproval', (params, rpcId) => {
      const p = params as FileChangeApprovalParams;
      return this.#askApproval(rpcId, p.turnId, {
        kind: 'file-change',
        reason: p.reason ?? null,
        files: this.#fileChanges.get(p.itemId) ?? (p.grantRoot ? [p.grantRoot] : []),
        // 文件修改按访问模式放行，不存规则。
        rule: null,
      });
    });

    const init: InitializeParams = {
      clientInfo: { name: 'baocut', title: 'BaoCut', version: RUNTIME_VERSION },
      capabilities: null,
    };
    await conn.request('initialize', init);
    conn.notify('initialized');

    const confined = options.confinement === 'cwd-write-only';
    this.#confined = confined;
    const policy = confined ? CONFINED_POLICY : codexPolicy(options.accessMode);
    this.#sandbox = policy.sandbox;
    this.#escalationOnly = policy.approvalPolicy === 'on-request';
    const config: NonNullable<ThreadStartParams['config']> = {
      ...(options.mcpServers ? { mcp_servers: codexMcpServers(options.mcpServers) } : {}),
      ...(confined ? { sandbox_workspace_write: CONFINED_WORKSPACE_WRITE } : {}),
    };
    const base: ThreadStartParams = {
      cwd: options.cwd,
      ...policy,
      ...(options.model ? { model: options.model } : {}),
      developerInstructions: options.developerInstructions ?? null,
      ...(Object.keys(config).length > 0 ? { config } : {}),
    };
    const resumeThreadId = readThreadId(options.resume);
    if (resumeThreadId) {
      try {
        const params: ThreadResumeParams = { ...base, threadId: resumeThreadId, excludeTurns: true };
        const res = await conn.request<ThreadStartResponse>('thread/resume', params);
        this.#threadId = res.thread.id;
        return;
      } catch (error) {
        // 原生会话恢复不了时如实告知，不假装上下文还在（架构设计 §2.5）。
        this.#log.warn('Codex session resume failed; starting a new one', { error: String(error) });
        const warning = DriversCommon.resumeFailed({ name: 'Codex', error: errorMessage(error) });
        queueMicrotask(() => this.#emit({ type: 'session.warning', message: String(warning), ...refField('messageRef', warning) }));
      }
    }
    const res = await conn.request<ThreadStartResponse>('thread/start', base);
    this.#threadId = res.thread.id;
  }

  async startTurn(input: AgentInput, settings: TurnSettings): Promise<{ turnId: string }> {
    const policy = codexPolicy(settings.accessMode);
    const sandboxChanged = !this.#confined && policy.sandbox !== this.#sandbox;
    const params: TurnStartParams = {
      threadId: this.#requireThread(),
      input: codexUserInput(input),
      // 受限会话的策略固定；普通会话每一轮按会话当前的访问模式、模型与强度。
      ...(this.#confined ? {} : { approvalPolicy: policy.approvalPolicy, approvalsReviewer: policy.approvalsReviewer }),
      ...(sandboxChanged ? { sandboxPolicy: codexSandboxPolicy(policy.sandbox) } : {}),
      ...(settings.model ? { model: settings.model } : {}),
      ...(settings.effort ? { effort: settings.effort } : {}),
    };
    // 这一轮的审批可能先于应答到达：越界标记在发请求前就换成这一轮的。
    if (!this.#confined) this.#escalationOnly = policy.approvalPolicy === 'on-request';
    const res = await this.#conn.request<TurnStartResponse>('turn/start', params);
    if (sandboxChanged) this.#sandbox = policy.sandbox;
    // 应答与 turn/started、turn/completed 可能在同一批输出里到达：已经结束的回合不再记成活动的。
    if (res.turn.status === 'inProgress' && res.turn.id !== this.#lastCompletedTurnId) this.#activeTurnId = res.turn.id;
    return { turnId: res.turn.id };
  }

  /**
   * 把输入插进正在跑的回合（`turn/steer`，带 `expectedTurnId` 作前置条件）。
   * - 这个回合已经结束（BaoCut 记的活动回合不是它）：不发请求，直接 `unavailable`。
   * - Codex 明确拒绝（方法不存在、没有活动回合、活动回合不是它、回合不可插话）：`unavailable`，输入确定没送进去。
   * - 超时、断线之类说不清送没送到的：抛错，不报 `unavailable`——Harness 会把它当成没送进去，界面再发一次就重复了。
   */
  async steer(turnId: string, input: AgentInput): Promise<'accepted' | 'unavailable'> {
    if (!this.#threadId || this.#activeTurnId !== turnId) return 'unavailable';
    const params: TurnSteerParams = { threadId: this.#threadId, input: codexUserInput(input), expectedTurnId: turnId };
    try {
      const res = await this.#conn.request<TurnSteerResponse>('turn/steer', params, 30_000);
      if (res?.turnId !== turnId) throw new Error(String(DriversCodex.steerMismatch({ expected: turnId, received: String(res?.turnId) })));
      return 'accepted';
    } catch (error) {
      if (isDefinitiveSteerRejection(error)) return 'unavailable';
      throw error;
    }
  }

  async interrupt(turnId: string): Promise<InterruptReceipt> {
    try {
      await this.#conn.request('turn/interrupt', { threadId: this.#requireThread(), turnId }, 15_000);
      return { status: 'requested' };
    } catch (error) {
      this.#log.warn('Codex interrupt request failed', { error: String(error) });
      return { status: 'unknown' };
    }
  }

  async respondToApproval(approvalId: Id, response: ApprovalResponse): Promise<void> {
    const pending = this.#approvals.get(approvalId);
    if (!pending) return;
    this.#approvals.delete(approvalId);
    this.#approvalByRpc.delete(String(pending.rpcId));
    pending.settle(DECISION[response.decision]);
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  describePersistence(): AgentPersistenceHandle | null {
    return this.#threadId ? { driverId: 'codex', data: { threadId: this.#threadId } } : null;
  }

  async close(): Promise<void> {
    for (const pending of this.#approvals.values()) pending.abandon();
    this.#approvals.clear();
    await this.#conn.close();
  }

  #requireThread(): string {
    if (!this.#threadId) throw new Error(String(DriversCommon.sessionNotReady({ name: 'Codex' })));
    return this.#threadId;
  }

  #emit(event: AgentEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        this.#log.error('AgentEvent listener threw', { error: String(error) });
      }
    }
  }

  #askApproval(
    rpcId: RpcId,
    turnId: string,
    request: Extract<AgentEvent, { type: 'approval.requested' }>['request'],
  ): Promise<{ decision: CodexApprovalDecision }> {
    return new Promise((resolve, reject) => {
      const approvalId = newId('appr');
      this.#approvals.set(approvalId, {
        rpcId,
        settle: (decision) => resolve({ decision }),
        abandon: () => reject(NO_RESPONSE),
      });
      this.#approvalByRpc.set(String(rpcId), approvalId);
      this.#emit({ type: 'approval.requested', turnId, approvalId, request, ...(this.#escalationOnly ? { escalation: true } : {}) });
    });
  }

  #onNotification(method: string, raw: unknown): void {
    const p = (raw ?? {}) as Record<string, unknown>;
    if (typeof p.threadId === 'string' && this.#threadId && p.threadId !== this.#threadId) return;
    const turnId = typeof p.turnId === 'string' ? p.turnId : '';

    switch (method) {
      case 'turn/started': {
        const turnId = (p.turn as CodexTurn).id;
        this.#activeTurnId = turnId;
        this.#emit({ type: 'turn.started', turnId });
        return;
      }
      case 'turn/completed': {
        const turn = p.turn as CodexTurn;
        if (this.#activeTurnId === turn.id) this.#activeTurnId = null;
        this.#lastCompletedTurnId = turn.id;
        const stashed = this.#turnFailures.get(turn.id) ?? null;
        this.#turnFailures.delete(turn.id);
        const outcome = turn.status === 'interrupted' ? 'interrupted' : turn.status === 'failed' ? 'failed' : 'completed';
        // 失败的回合：优先用回合自己带的错误，没有时用之前那条不再重试的错误通知。
        const failure = outcome === 'failed' ? (turn.error ? turnFailure(turn.error) : stashed) : null;
        if (outcome !== 'failed' && stashed) {
          // 报过错却没失败（按协议不该发生）：别把那条错误吞掉。
          this.#emit({
            type: 'session.error',
            turnId: turn.id,
            message: textOf(stashed.message),
            ...refField('messageRef', stashed.message),
            willRetry: false,
            code: stashed.code,
          });
        }
        this.#emit({
          type: 'turn.completed',
          turnId: turn.id,
          outcome,
          error: textOf(failure?.message) ?? turn.error?.message ?? null,
          ...refField('errorRef', failure?.message),
          errorCode: failure?.code ?? null,
        });
        return;
      }
      case 'item/started':
      case 'item/completed': {
        const item = p.item as CodexThreadItem;
        if (item.type === 'fileChange') {
          const changes = (item as { changes?: Array<{ path: string }> }).changes ?? [];
          this.#fileChanges.set(
            item.id,
            changes.map((c) => c.path),
          );
        }
        this.#emit({
          type: method === 'item/started' ? 'item.started' : 'item.completed',
          turnId,
          item: mapCodexItem(item),
        });
        return;
      }
      case 'item/agentMessage/delta':
      case 'item/plan/delta':
        this.#emit({ type: 'item.delta', turnId, itemId: String(p.itemId), channel: 'text', delta: String(p.delta ?? '') });
        return;
      case 'item/reasoning/summaryTextDelta':
        this.#emit({ type: 'item.delta', turnId, itemId: String(p.itemId), channel: 'reasoning', delta: String(p.delta ?? '') });
        return;
      case 'item/reasoning/summaryPartAdded':
        if (Number(p.summaryIndex) > 0) {
          this.#emit({ type: 'item.delta', turnId, itemId: String(p.itemId), channel: 'reasoning', delta: '\n\n' });
        }
        return;
      case 'item/commandExecution/outputDelta':
        this.#emit({ type: 'item.delta', turnId, itemId: String(p.itemId), channel: 'output', delta: String(p.delta ?? '') });
        return;
      case 'serverRequest/resolved': {
        const approvalId = this.#approvalByRpc.get(String(p.requestId));
        if (!approvalId) return;
        this.#approvalByRpc.delete(String(p.requestId));
        this.#approvals.get(approvalId)?.abandon();
        this.#approvals.delete(approvalId);
        this.#emit({ type: 'approval.resolved', approvalId });
        return;
      }
      case 'error': {
        const failure = turnFailure((p.error ?? {}) as Partial<CodexTurnError>);
        const willRetry = p.willRetry === true;
        // 不再重试、属于正在跑的回合：紧接着的 turn/completed（failed）会带上它，那时一起报，免得界面上出现两遍。
        if (!willRetry && turnId && turnId === this.#activeTurnId) {
          this.#turnFailures.set(turnId, failure);
          return;
        }
        // 会重试的（回合继续）、或不属于正在跑的回合：作为会话错误报出来，不结束回合。
        this.#emit({
          type: 'session.error',
          turnId: turnId || null,
          message: textOf(failure.message),
          ...refField('messageRef', failure.message),
          willRetry,
          code: failure.code,
        });
        return;
      }
      default:
        this.#log.debug('Ignoring codex notification', { method });
    }
  }
}

export function codexMcpServers(servers: Record<string, McpServerSpec>): Record<string, CodexMcpServer> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, spec]) => [
      name,
      {
        url: spec.url,
        http_headers: spec.headers,
        default_tools_approval_mode: 'approve' as const,
        tool_timeout_sec: CODEX_TOOL_TIMEOUT_SEC,
      },
    ]),
  );
}

function turnFailure(error: Partial<CodexTurnError>): TurnFailure {
  const message: DriverText = typeof error.message === 'string' && error.message ? error.message : DriversCommon.unknownError();
  return {
    message,
    code: classifyCodexError({ message: String(message), codexErrorInfo: error.codexErrorInfo ?? null, additionalDetails: error.additionalDetails ?? null }),
  };
}

/**
 * `turn/steer` 确定没把输入送进去的几种拒绝（app-server `turn_processor.rs` 的原话，对照 codex 源码与 0.159.0）：
 * 方法不存在（`-32601`），或 `-32600` 且是「没有活动回合」「活动回合不是这个」「这个回合不可插话」（`activeTurnNotSteerable`）。
 * 别的 `-32600`、超时、断线都算说不清。
 */
function isDefinitiveSteerRejection(error: unknown): boolean {
  if (!(error instanceof CodexRpcError)) return false;
  if (error.code === -32601) return true;
  if (error.code !== -32600) return false;
  const data = error.data as { codexErrorInfo?: unknown } | null | undefined;
  const info = data?.codexErrorInfo;
  if (info && typeof info === 'object' && 'activeTurnNotSteerable' in info) return true;
  return error.message === 'no active turn to steer' || /^expected active turn id `[^`]+` but found `[^`]+`$/.test(error.message);
}

function readThreadId(handle: AgentPersistenceHandle | null): string | null {
  if (!handle || handle.driverId !== 'codex') return null;
  const data = handle.data as { threadId?: unknown } | null;
  return typeof data?.threadId === 'string' ? data.threadId : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
