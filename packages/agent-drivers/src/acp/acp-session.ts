/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/acp-agent.ts 的 ACPAgentSession：initializeResumedSession（先 session/load，
 * 再 session/resume；恢复时不丢 cwd 与 mcpServers）、replayingHistory（加载时回放的历史不当成新内容）、
 * handlePromptResponse（stopReason → 回合结果）、requestPermission 的挂起表、setMode / setModel（session/set_model）、
 * closeSession；generic-acp-agent.ts 的通用会话装配。
 * 改成 BaoCut 的 AgentSession 事件；「本会话放行」由 Driver 自己记，从不选原生的「总是允许」；访问模式按更严的一方映射。
 */
import fs from 'node:fs/promises';
import { RpcError, newId, normalizeAgentMode, type AgentErrorCode, type DriverProbe, type Id, type Localized } from '@baocut/protocol';
import { DriversAcp, DriversCommon } from '@baocut/protocol/messages/agent-drivers';
import type {
  AgentEvent,
  AgentInput,
  AgentPersistenceHandle,
  AgentSession,
  ApprovalResponse,
  CreateSessionOptions,
  InterruptReceipt,
  Logger,
  TurnSettings,
} from '@baocut/harness';
import type {
  AgentCapabilities,
  Client,
  ContentBlock,
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SessionUpdate,
} from '@agentclientprotocol/sdk';
import { refField, textOf, type DriverText } from '../driver-text.ts';
import type { AcpInstall } from './acp-binary.ts';
import { AcpProcess, acpErrorMessage, isAuthRequired, withTimeout } from './acp-connection.ts';
import {
  acpMcpServers,
  approvalOf,
  availableModes,
  contentText,
  findSelectOption,
  isOwnMcpTool,
  mergeToolSnapshot,
  planText,
  selectPermissionOption,
  toolItem,
  type AcpSessionState,
  type ToolSnapshot,
} from './acp-items.ts';
import { ACP_ENV, loginAdvice, type AcpPreset } from './acp-presets.ts';

/** 会话能力：ACP 没有往进行中的回合插话的通道；图片与恢复看智能体的 `initialize` 应答。 */
export function acpCapabilities(caps: AgentCapabilities | null | undefined): DriverProbe['capabilities'] {
  return {
    steer: false,
    approvals: true,
    resume: caps?.loadSession === true || !!caps?.sessionCapabilities?.resume,
    images: caps?.promptCapabilities?.image === true,
  };
}

/** 带结构化原因的启动错误：Harness 读 `agentCode`（`AGENT_AUTH_REQUIRED` 之类）。 */
export function agentError(code: ConstructorParameters<typeof RpcError>[0], message: string | Localized, agentCode: AgentErrorCode | null): RpcError {
  const error = new RpcError(code, message);
  return agentCode ? Object.assign(error, { agentCode }) : error;
}

interface OpenMessage {
  id: string;
  kind: 'agent-message' | 'reasoning';
  text: string;
}

interface Turn {
  id: string;
  cancelled: boolean;
  message: OpenMessage | null;
  tools: Map<string, ToolSnapshot>;
  finished: Set<string>;
  declined: Set<string>;
  planId: string | null;
}

interface PendingApproval {
  turnId: string;
  toolCallId: string;
  options: PermissionOption[];
  grantKey: string;
  resolve: (response: RequestPermissionResponse) => void;
}

const CANCELLED: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } };

export class AcpSession implements AgentSession {
  readonly id: Id = newId('ags');
  capabilities: DriverProbe['capabilities'] = acpCapabilities(null);

  readonly #preset: AcpPreset;
  readonly #log: Logger;
  readonly #cwd: string;
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  readonly #approvals = new Map<Id, PendingApproval>();
  /** 「本会话放行」过的类别（`approvalOf` 的分类键）：之后同类的请求直接答应，不再来问。 */
  readonly #grants = new Set<string>();
  /** 传给智能体的 MCP 服务名（BaoCut 的工具通道）：这些工具的原生审批直接放行（`isOwnMcpTool`）。 */
  #mcpServerNames: ReadonlySet<string> = new Set();
  #proc!: AcpProcess;
  #sessionId: string | null = null;
  #state: AcpSessionState = {};
  #modeId: string | null = null;
  #modelId: string | null = null;
  #modeWarned = false;
  /** `session/load` 回放历史期间：这些更新是旧内容，不当成这一轮的输出。 */
  #replaying = false;
  /** 新会话第一轮前面附上的开发者指令（ACP 的 `session/new` 没有这个字段）。 */
  #instructions: string | null = null;
  #turn: Turn | null = null;
  #closed = false;
  #early: AgentEvent[] | null = [];

  private constructor(preset: AcpPreset, options: CreateSessionOptions, log: Logger) {
    this.#preset = preset;
    this.#cwd = options.cwd;
    this.#log = log;
  }

  static async start(install: AcpInstall, preset: AcpPreset, options: CreateSessionOptions, log: Logger): Promise<AcpSession> {
    if (options.confinement) {
      // ACP 没有沙箱参数，限制不了只写工作目录、不联网（架构设计 §6.9）。
      throw new RpcError('driver-unavailable', DriversCommon.confinedUnsupported({ name: preset.name }));
    }
    const session = new AcpSession(preset, options, log);
    const client: Client = {
      requestPermission: (params) => session.#onPermission(params),
      sessionUpdate: (params) => session.#onUpdate(params),
    };
    try {
      session.#proc = await AcpProcess.start({
        command: install.command,
        args: preset.args,
        cwd: options.cwd,
        env: { ...install.env, ...preset.env, ...ACP_ENV },
        log,
        label: preset.name,
        client,
      });
    } catch (error) {
      throw agentError('driver-failed', DriversCommon.startFailed({ name: preset.name, error: acpErrorMessage(error) }), null);
    }
    try {
      await session.#open(options);
    } catch (error) {
      await session.#proc.close();
      if (error instanceof RpcError) throw error;
      if (isAuthRequired(error)) {
        throw agentError(
          'driver-unavailable',
          DriversAcp.signedOut({ name: preset.name, login: loginAdvice(preset), detail: acpErrorMessage(error) }),
          'AGENT_AUTH_REQUIRED',
        );
      }
      throw agentError('driver-failed', DriversCommon.openSessionFailed({ name: preset.name, error: acpErrorMessage(error) }), null);
    }
    void session.#proc.exited.then((reason) => session.#onExit(reason));
    return session;
  }

  async #open(options: CreateSessionOptions): Promise<void> {
    const caps = this.#proc.init.agentCapabilities;
    this.capabilities = acpCapabilities(caps);
    const conn = this.#proc.connection;
    let mcpServers = acpMcpServers(options.mcpServers);
    if (mcpServers.length > 0 && caps?.mcpCapabilities?.http !== true) {
      // 已知限制：BaoCut 的工具通道只有 Streamable HTTP，没有给只认 stdio 的智能体做转接。
      mcpServers = [];
      this.#warn(DriversAcp.mcpHttpUnsupported({ name: this.#preset.name }));
    }
    this.#mcpServerNames = new Set(mcpServers.map((server) => server.name));
    const params = { cwd: options.cwd, mcpServers };

    const resumeId = readSessionId(options.resume, this.#preset.id);
    if (resumeId) {
      try {
        if (caps?.loadSession) {
          this.#replaying = true;
          try {
            const res = await conn.loadSession({ sessionId: resumeId, ...params });
            this.#adopt(resumeId, res as AcpSessionState);
          } finally {
            this.#replaying = false;
          }
          return;
        }
        if (caps?.sessionCapabilities?.resume) {
          const res = await conn.resumeSession({ sessionId: resumeId, ...params });
          this.#adopt(resumeId, res as AcpSessionState);
          return;
        }
        throw new Error(String(DriversAcp.resumeUnsupported({ name: this.#preset.name })));
      } catch (error) {
        if (isAuthRequired(error)) throw error;
        // 原生会话恢复不了时如实告知，不假装上下文还在（架构设计 §2.5）。
        this.#log.warn('ACP session resume failed; starting a new one', { error: acpErrorMessage(error) });
        this.#warn(DriversCommon.resumeFailed({ name: this.#preset.name, error: acpErrorMessage(error) }));
      }
    }
    const res = await conn.newSession(params);
    this.#adopt(res.sessionId, res as AcpSessionState);
    this.#instructions = options.developerInstructions?.trim() || null;
  }

  #adopt(sessionId: string, state: AcpSessionState): void {
    this.#sessionId = sessionId;
    this.#state = { modes: state.modes ?? null, models: state.models ?? null, configOptions: state.configOptions ?? null };
    this.#modeId = state.modes?.currentModeId ?? findSelectOption(state.configOptions, 'mode')?.currentValue ?? null;
    this.#modelId = state.models?.currentModelId ?? findSelectOption(state.configOptions, 'model')?.currentValue ?? null;
  }

  async startTurn(input: AgentInput, settings: TurnSettings): Promise<{ turnId: string }> {
    if (this.#closed) throw new Error(String(DriversCommon.sessionClosed({ name: this.#preset.name })));
    if (this.#turn) throw new Error(String(DriversCommon.turnInProgress()));
    const sessionId = this.#requireSession();
    await this.#applyMode(settings);
    await this.#applyModel(settings);
    const prompt = await this.#prompt(input);
    const turnId = newId('turn');
    const turn: Turn = {
      id: turnId,
      cancelled: false,
      message: null,
      tools: new Map(),
      finished: new Set(),
      declined: new Set(),
      planId: null,
    };
    this.#turn = turn;
    this.#instructions = null;
    this.#emit({ type: 'turn.started', turnId });
    this.#proc.connection.prompt({ sessionId, prompt }).then(
      (res) => this.#finishTurn(turn, res.stopReason === 'cancelled' || turn.cancelled ? 'interrupted' : 'completed', null, null),
      async (error: unknown) => {
        // 进程退了：交给 session.exited（Harness 记成 AGENT_EXITED），这里不再报一遍。
        const exited = await withTimeout(
          this.#proc.exited.then(() => true),
          300,
          'alive',
        ).catch(() => false);
        if (exited && !turn.cancelled) return this.#dropTurn(turn);
        if (turn.cancelled) return this.#finishTurn(turn, 'interrupted', null, null);
        const code: AgentErrorCode | null = isAuthRequired(error) ? 'AGENT_AUTH_REQUIRED' : null;
        this.#finishTurn(turn, 'failed', acpErrorMessage(error), code);
      },
    );
    return { turnId };
  }

  async interrupt(turnId: string): Promise<InterruptReceipt> {
    const turn = this.#turn;
    if (!turn || turn.id !== turnId) return { status: 'not-running' };
    turn.cancelled = true;
    // ACP 要求取消之后，挂着的审批一律以 cancelled 作答。
    this.#settleApprovals(turn.id);
    try {
      await withTimeout(this.#proc.connection.cancel({ sessionId: this.#requireSession() }), 15_000, 'session/cancel timed out');
      return { status: 'requested' };
    } catch (error) {
      this.#log.warn('ACP interrupt request failed', { error: acpErrorMessage(error) });
      return { status: 'unknown' };
    }
  }

  async respondToApproval(approvalId: Id, response: ApprovalResponse): Promise<void> {
    const pending = this.#approvals.get(approvalId);
    if (!pending) return;
    this.#approvals.delete(approvalId);
    // 「总是允许」的规则归 Harness 存；原生侧只按会话级放行处理，由这里记住，不选智能体自己的 allow_always。
    if (response.decision === 'accept-for-session' || response.decision === 'accept-always') this.#grants.add(pending.grantKey);
    switch (response.decision) {
      case 'accept':
      case 'accept-for-session':
      case 'accept-always': {
        const option = selectPermissionOption(pending.options, 'allow');
        if (option) {
          pending.resolve({ outcome: { outcome: 'selected', optionId: option.optionId } });
          return;
        }
        // 智能体只给了「总是允许」：不替用户写进它的持久设置，这次按拒绝处理。
        this.#warn(DriversAcp.onlyAlwaysAllow({ name: this.#preset.name }));
        this.#reject(pending);
        return;
      }
      case 'decline':
        this.#reject(pending);
        return;
      case 'cancel':
        pending.resolve(CANCELLED);
        if (this.#turn?.id === pending.turnId) await this.interrupt(pending.turnId);
        return;
    }
  }

  #reject(pending: PendingApproval): void {
    if (this.#turn?.id === pending.turnId) this.#turn.declined.add(pending.toolCallId);
    const option = selectPermissionOption(pending.options, 'reject');
    pending.resolve(option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : CANCELLED);
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.#listeners.add(listener);
    const early = this.#early;
    if (early) {
      this.#early = null;
      // 订阅方可能还没登记好这个会话（AgentManager 订阅之后才记下它）：下一个微任务再补发。
      queueMicrotask(() => early.forEach((event) => this.#emit(event)));
    }
    return () => this.#listeners.delete(listener);
  }

  describePersistence(): AgentPersistenceHandle | null {
    return this.#sessionId ? { driverId: this.#preset.id, data: { sessionId: this.#sessionId } } : null;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#settleApprovals(null);
    const caps = this.#proc.init.agentCapabilities;
    if (this.#sessionId && caps?.sessionCapabilities?.close && !this.#proc.hasExited) {
      await withTimeout(this.#proc.connection.closeSession({ sessionId: this.#sessionId }), 2000, 'session/close timed out').catch(
        () => undefined,
      );
    }
    await this.#proc.close();
  }

  // ---- 每一轮的模式与模型 ----

  /**
   * 访问模式 → 会话模式：取预设候选里智能体有的第一个（见 acp-presets.ts 的映射表）。预设有「全部放行」配置项的
   * （`permissionOption`），完全访问时打开它、别的模式关掉它；离开完全访问时先关它再换模式。
   */
  async #applyMode(settings: TurnSettings): Promise<void> {
    const mode = normalizeAgentMode(settings.accessMode);
    if (mode !== 'fullAccess') await this.#applyPermissionOption(false);
    const candidates = this.#preset.modes[mode === 'plan' ? 'plan' : mode === 'fullAccess' ? 'fullAccess' : 'ask'];
    const available = availableModes(this.#state);
    const target = candidates.find((id) => available.ids.includes(id)) ?? null;
    if (!target) {
      this.#warnModeOnce();
    } else if (target !== this.#modeId) {
      const sessionId = this.#requireSession();
      try {
        if (available.via === 'config' && available.configId) {
          const res = await this.#proc.connection.setSessionConfigOption({ sessionId, configId: available.configId, value: target });
          if (res?.configOptions?.length) this.#state.configOptions = res.configOptions;
        } else {
          await this.#proc.connection.setSessionMode({ sessionId, modeId: target });
        }
        this.#modeId = target;
      } catch (error) {
        // 设不上就不开这一轮：按更宽的模式跑会越过 BaoCut 的访问模式。
        throw agentError('driver-failed', DriversAcp.modeSwitchFailed({ name: this.#preset.name, mode: target, error: acpErrorMessage(error) }), null);
      }
    }
    if (mode === 'fullAccess') await this.#applyPermissionOption(true);
  }

  /**
   * 「全部放行」配置项（`permissionOption`）设成 `on` / `off`，已经是了就不发。会话里没有这个配置项：打开时提示一次（按逐项询问运行，
   * 更严），关闭时无事可做。关不掉就不开这一轮（会比 BaoCut 的模式更宽）；打不开只提示（更严）。
   */
  async #applyPermissionOption(on: boolean): Promise<void> {
    const spec = this.#preset.permissionOption;
    if (!spec) return;
    const option = this.#state.configOptions?.find((o) => o.type === 'select' && o.id === spec.configId);
    if (!option) {
      if (on) this.#warnModeOnce(DriversAcp.noAllowAllSwitch({ name: this.#preset.name, configId: spec.configId }));
      return;
    }
    const value = on ? spec.on : spec.off;
    if (option.type === 'select' && option.currentValue === value) return;
    const sessionId = this.#requireSession();
    try {
      const res = await this.#proc.connection.setSessionConfigOption({ sessionId, configId: spec.configId, value });
      if (res?.configOptions?.length) this.#state.configOptions = res.configOptions;
      else if (option.type === 'select') option.currentValue = value;
    } catch (error) {
      const message = DriversAcp.setOptionFailed({ name: this.#preset.name, configId: spec.configId, value, error: acpErrorMessage(error) });
      if (!on) throw agentError('driver-failed', message, null);
      this.#warn(DriversAcp.stillAskThisTurn({ failure: message }));
    }
  }

  /** 访问模式落不到智能体上（没有对应的会话模式或开关）：整个会话只提示一次。 */
  #warnModeOnce(message?: Localized): void {
    if (this.#modeWarned) return;
    this.#modeWarned = true;
    this.#warn(message ?? DriversAcp.noMatchingMode({ name: this.#preset.name }));
  }

  async #applyModel(settings: TurnSettings): Promise<void> {
    const model = settings.model;
    if (!model || model === this.#modelId) return;
    const sessionId = this.#requireSession();
    const option = findSelectOption(this.#state.configOptions, 'model');
    try {
      if (option) {
        const res = await this.#proc.connection.setSessionConfigOption({ sessionId, configId: option.id, value: model });
        if (res?.configOptions?.length) this.#state.configOptions = res.configOptions;
      } else if (this.#state.models) {
        // 旧版的模型切换（SDK 0.29 已经不带这个方法的封装）。
        await this.#proc.connection.extMethod('session/set_model', { sessionId, modelId: model });
      } else {
        this.#warn(DriversAcp.modelSwitchUnsupported({ name: this.#preset.name }));
        this.#modelId = model;
        return;
      }
      this.#modelId = model;
    } catch (error) {
      throw agentError(
        'driver-failed',
        DriversCommon.modelSwitchFailed({ name: this.#preset.name, model, error: acpErrorMessage(error) }),
        'AGENT_MODEL_UNAVAILABLE',
      );
    }
  }

  /** BaoCut 的输入 → ACP 的内容块：新会话第一轮先附开发者指令，再是文字与图片（不支持图片时 Harness 不会传）。 */
  async #prompt(input: AgentInput): Promise<ContentBlock[]> {
    const blocks: ContentBlock[] = [];
    if (this.#instructions) blocks.push({ type: 'text', text: `<system-instructions>\n${this.#instructions}\n</system-instructions>` });
    if (input.text || !input.images?.length) blocks.push({ type: 'text', text: input.text });
    for (const image of input.images ?? []) {
      blocks.push({ type: 'image', mimeType: image.mimeType, data: (await fs.readFile(image.path)).toString('base64') });
    }
    return blocks;
  }

  // ---- 智能体发来的请求与通知 ----

  async #onPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const turn = this.#turn;
    if (this.#replaying || !turn || turn.cancelled || params.sessionId !== this.#sessionId) return CANCELLED;
    const id = params.toolCall.toolCallId;
    const snapshot = mergeToolSnapshot(id, params.toolCall, turn.tools.get(id));
    turn.tools.set(id, snapshot);
    if (isOwnMcpTool(snapshot, this.#mcpServerNames)) {
      const option = selectPermissionOption(params.options, 'allow');
      if (option) return { outcome: { outcome: 'selected', optionId: option.optionId } };
    }
    const { request, grantKey } = approvalOf(snapshot, this.#cwd);
    if (this.#grants.has(grantKey)) {
      const option = selectPermissionOption(params.options, 'allow');
      if (option) return { outcome: { outcome: 'selected', optionId: option.optionId } };
    }
    return new Promise((resolve) => {
      const approvalId = newId('appr');
      this.#approvals.set(approvalId, { turnId: turn.id, toolCallId: id, options: params.options, grantKey, resolve });
      this.#emit({ type: 'approval.requested', turnId: turn.id, approvalId, request });
    });
  }

  #onUpdate(notification: SessionNotification): void {
    if (this.#replaying || notification.sessionId !== this.#sessionId) return;
    const update: SessionUpdate = notification.update;
    switch (update.sessionUpdate) {
      case 'current_mode_update':
        this.#modeId = update.currentModeId;
        return;
      case 'config_option_update':
        this.#state.configOptions = update.configOptions;
        return;
      case 'available_commands_update':
        // 斜杠命令：BaoCut 的界面暂不列出。
        return;
    }
    const turn = this.#turn;
    if (!turn) {
      this.#log.debug('Ignoring ACP update outside a turn', { kind: update.sessionUpdate });
      return;
    }
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        this.#append(turn, 'agent-message', contentText(update.content));
        return;
      case 'agent_thought_chunk':
        this.#append(turn, 'reasoning', contentText(update.content));
        return;
      case 'tool_call':
      case 'tool_call_update': {
        this.#closeMessage(turn);
        const id = update.toolCallId;
        const previous = turn.tools.get(id);
        const snapshot = mergeToolSnapshot(id, update, previous);
        turn.tools.set(id, snapshot);
        const terminal = snapshot.status === 'completed' || snapshot.status === 'failed';
        if (terminal && !turn.finished.has(id)) {
          turn.finished.add(id);
          const status = turn.declined.has(id) && snapshot.status === 'failed' ? 'declined' : undefined;
          this.#emit({ type: 'item.completed', turnId: turn.id, item: toolItem(snapshot, status, this.#cwd) });
        } else if (!terminal && (!previous || update.sessionUpdate === 'tool_call')) {
          this.#emit({ type: 'item.started', turnId: turn.id, item: toolItem(snapshot, undefined, this.#cwd) });
        }
        return;
      }
      case 'plan': {
        this.#closeMessage(turn);
        turn.planId ??= newId('item');
        this.#emit({ type: 'item.completed', turnId: turn.id, item: { kind: 'agent-message', id: turn.planId, text: planText(update) } });
        return;
      }
      default:
        this.#log.debug('Ignoring ACP update', { kind: update.sessionUpdate });
    }
  }

  #append(turn: Turn, kind: OpenMessage['kind'], text: string): void {
    if (!text) return;
    if (turn.message && turn.message.kind !== kind) this.#closeMessage(turn);
    turn.message ??= { id: newId('item'), kind, text: '' };
    turn.message.text += text;
    this.#emit({
      type: 'item.delta',
      turnId: turn.id,
      itemId: turn.message.id,
      channel: kind === 'reasoning' ? 'reasoning' : 'text',
      delta: text,
    });
  }

  #closeMessage(turn: Turn): void {
    const message = turn.message;
    if (!message) return;
    turn.message = null;
    this.#emit({ type: 'item.completed', turnId: turn.id, item: { kind: message.kind, id: message.id, text: message.text } });
  }

  #finishTurn(turn: Turn, outcome: 'completed' | 'interrupted' | 'failed', error: DriverText | null, code: AgentErrorCode | null): void {
    if (this.#turn !== turn) return;
    this.#closeMessage(turn);
    // 回合结束时还没有终态的步骤：被拒的记成 declined，别的不能当成完成。
    for (const [id, snapshot] of turn.tools) {
      if (turn.finished.has(id)) continue;
      turn.finished.add(id);
      this.#emit({
        type: 'item.completed',
        turnId: turn.id,
        item: toolItem(snapshot, turn.declined.has(id) ? 'declined' : 'interrupted', this.#cwd),
      });
    }
    this.#settleApprovals(turn.id);
    this.#turn = null;
    this.#emit({ type: 'turn.completed', turnId: turn.id, outcome, error: textOf(error), ...refField('errorRef', error), errorCode: code });
  }

  #dropTurn(turn: Turn): void {
    if (this.#turn === turn) this.#turn = null;
  }

  /** 挂着的审批以 cancelled 作答，界面上的卡片收起。`turnId` 为 null 时全部。 */
  #settleApprovals(turnId: string | null): void {
    for (const [approvalId, pending] of this.#approvals) {
      if (turnId !== null && pending.turnId !== turnId) continue;
      this.#approvals.delete(approvalId);
      pending.resolve(CANCELLED);
      this.#emit({ type: 'approval.resolved', approvalId });
    }
  }

  #onExit(reason: Localized | null): void {
    this.#settleApprovals(null);
    this.#turn = null;
    const error = this.#closed ? null : reason;
    this.#emit({ type: 'session.exited', error: textOf(error), ...refField('errorRef', error) });
  }

  #requireSession(): string {
    if (!this.#sessionId) throw new Error(String(DriversCommon.sessionNotReady({ name: this.#preset.name })));
    return this.#sessionId;
  }

  #warn(message: DriverText): void {
    this.#emit({ type: 'session.warning', message: String(message), ...refField('messageRef', message) });
  }

  #emit(event: AgentEvent): void {
    // 开会话期间的提示（恢复失败、用不了 BaoCut 的工具）在 Harness 订阅之前发出：先存着，订阅时补发。
    if (this.#early) {
      this.#early.push(event);
      return;
    }
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        this.#log.error('AgentEvent listener failed', { error: String(error) });
      }
    }
  }
}

function readSessionId(handle: AgentPersistenceHandle | null, driverId: string): string | null {
  if (!handle || handle.driverId !== driverId) return null;
  const data = handle.data as { sessionId?: unknown } | null;
  return typeof data?.sessionId === 'string' ? data.sessionId : null;
}
