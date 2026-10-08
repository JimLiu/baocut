/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/opencode/v2/session.ts（先订阅事件流、等 `server.connected`；按 sessionID
 * 过滤事件；`mcp.add` 远程 MCP 后轮询 `mcp.list` 到 connected；开发者指令写进会话的 instructions 条目；恢复时
 * `session.get`），v2/turns.ts（回合由 `session.execution.*` 收尾、`session.active` 确认不再运行、steer 用
 * `delivery: 'steer'`、中断用 `session.interrupt`），v2/permissions.ts（`permission.asked` / `permission.replied`、
 * 以 once / reject 作答），v2/timeline.ts（文字与推理按 assistantMessageID 与 ordinal 分段）。
 * 改成 BaoCut 的 AgentSession 事件：一个会话一个 serve 进程；「本会话放行」由 Driver 自己记，从不回原生的 always；
 * 访问模式映射成会话的权限规则（两边取更严的）；拒绝一个工具后 OpenCode 以 `interrupted(shutdown)` 结束执行，
 * 这里记成回合完成、那一步记成 declined。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RpcError,
  newId,
  normalizeAgentMode,
  type AgentErrorCode,
  type AgentMode,
  type DriverId,
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
  type TurnSettings,
} from '@baocut/harness';
import { DriversCommon, DriversOpencode } from '@baocut/protocol/messages/agent-drivers';
import { agentError } from '../acp/acp-session.ts';
import { refField, textOf, type DriverText } from '../driver-text.ts';
import type { OpenCodeInstall } from './opencode-binary.ts';
import { approvalOf, contentText, permissionRules, record, toolItem, type PermissionRequest, type ToolState } from './opencode-items.ts';
import { modelRef, waitForLocation } from './opencode-models.ts';
import { OPENCODE_PRESET } from './opencode-preset.ts';
import { OpenCodeHttpError, OpenCodeServer, type OpenCodeEvent } from './opencode-server.ts';

/** OpenCode 的会话能力：v2 有插话（`delivery: 'steer'`）、原生审批、按 id 恢复，提示词可以带图片（data URI）。 */
export function openCodeCapabilities(): DriverProbe['capabilities'] {
  return { steer: true, approvals: true, resume: true, images: true };
}

/** Driver id（`BUILTIN_DRIVER_IDS` 里的 `opencode`）。 */
export const OPENCODE_DRIVER_ID: DriverId = 'opencode';

/** 执行结束之后等多久再确认会话不再运行（排在后面的插话会立即开始下一次执行）。 */
const SETTLE_MS = 150;

interface OpenMessage {
  id: string;
  kind: 'agent-message' | 'reasoning';
  text: string;
}

interface Turn {
  id: string;
  cancelled: boolean;
  /** 这一轮里 BaoCut 拒绝过工具：OpenCode 随后以 `interrupted(shutdown)` 结束执行。 */
  rejected: boolean;
  messages: Map<string, OpenMessage>;
  tools: Map<string, ToolState>;
  finished: Set<string>;
  declined: Set<string>;
  /** 最近一次执行的结局；新的执行开始时清掉。 */
  ending: { kind: 'succeeded' | 'failed' | 'interrupted'; error: string | null; reason: string | null } | null;
  settleTimer: NodeJS.Timeout | null;
  /** 这一轮的提示词送到了（成功与否都算结束）：插话与中断等它，免得插话排到正文前面、中断落在执行开始之前。 */
  submitted: Promise<void>;
}

interface PendingApproval {
  turnId: string;
  requestId: string;
  toolId: string | null;
  grantKey: string;
}

export class OpenCodeSession implements AgentSession {
  readonly id: Id = newId('ags');
  readonly capabilities = openCodeCapabilities();

  readonly #server: OpenCodeServer;
  readonly #log: Logger;
  readonly #cwd: string;
  readonly #mcpNames: string[];
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  readonly #approvals = new Map<Id, PendingApproval>();
  /** 「本会话放行」过的类别（`approvalOf` 的分类键）：之后同类的请求直接答应，不再来问。 */
  readonly #grants = new Set<string>();
  #sessionId: string | null = null;
  #mode: AgentMode | null = null;
  #model: { providerID: string; id: string; variant?: string } | null = null;
  /** 开发者指令写不进会话的 instructions 条目时（接口不在），在第一轮前面附上。 */
  #instructions: string | null = null;
  #turn: Turn | null = null;
  #closed = false;
  #unsubscribe: (() => void) | null = null;
  #connected: (() => void) | null = null;
  #early: AgentEvent[] | null = [];

  private constructor(server: OpenCodeServer, options: CreateSessionOptions, log: Logger) {
    this.#server = server;
    this.#cwd = options.cwd;
    this.#log = log;
    this.#mcpNames = Object.keys(options.mcpServers ?? {});
  }

  static async start(
    install: OpenCodeInstall,
    options: CreateSessionOptions,
    log: Logger,
    startupTimeoutMs?: number,
  ): Promise<OpenCodeSession> {
    if (options.confinement) {
      // OpenCode 的权限规则管不住命令写到哪里、联不联网，做不到只写工作目录（架构设计 §6.9）。
      throw new RpcError('driver-unavailable', DriversCommon.confinedUnsupported({ name: OPENCODE_PRESET.name }));
    }
    let server: OpenCodeServer;
    try {
      server = await OpenCodeServer.start({ command: install.command, env: install.env, cwd: options.cwd, log, startupTimeoutMs });
    } catch (error) {
      throw agentError('driver-failed', DriversCommon.startFailed({ name: OPENCODE_PRESET.name, error: message(error) }), null);
    }
    const session = new OpenCodeSession(server, options, log);
    try {
      await session.#open(options, startupTimeoutMs ?? 30_000);
    } catch (error) {
      session.#closed = true;
      session.#unsubscribe?.();
      await server.close();
      if (error instanceof RpcError) throw error;
      throw agentError('driver-failed', DriversCommon.openSessionFailed({ name: OPENCODE_PRESET.name, error: message(error) }), null);
    }
    void server.exited.then((reason) => session.#onExit(reason));
    return session;
  }

  async #open(options: CreateSessionOptions, timeoutMs: number): Promise<void> {
    const server = this.#server;
    const cwd = options.cwd;
    // 先订阅事件流再建会话、发提示词：之后的事件一条不漏。
    const connected = new Promise<void>((resolve) => (this.#connected = resolve));
    this.#unsubscribe = server.subscribe(
      (event) => this.#onEvent(event),
      (error) => void this.#onStreamClosed(error),
    );
    await withTimeout(connected, timeoutMs, (seconds) => DriversOpencode.streamNotConnected({ seconds }));
    await waitForLocation(server, cwd, timeoutMs);
    await this.#connectMcp(options, timeoutMs);

    const resumeId = readSessionId(options.resume);
    if (resumeId) {
      try {
        const res = await server.request<{ data: SessionInfo }>('GET', `/api/session/${encodeURIComponent(resumeId)}`);
        this.#adopt(res.data);
      } catch (error) {
        // 原生会话恢复不了时如实告知，不假装上下文还在（架构设计 §2.5）。
        this.#log.warn('OpenCode session resume failed; starting a new one', { error: message(error) });
        this.#warn(DriversCommon.resumeFailed({ name: OPENCODE_PRESET.name, error: message(error) }));
      }
    }
    const mode = normalizeAgentMode(options.accessMode);
    const model = options.model ? requireModel(options.model, options.effort) : null;
    if (!this.#sessionId) {
      const res = await server.request<{ data: SessionInfo }>('POST', '/api/session', {
        body: { location: { directory: cwd }, agent: 'build', ...(model ? { model } : {}), permissions: permissionRules(mode) },
      });
      this.#adopt(res.data);
      this.#mode = mode;
    } else {
      await this.#applyMode(mode);
      if (model) await this.#applyModel(model);
    }
    const instructions = options.developerInstructions?.trim();
    if (instructions) await this.#putInstructions(instructions);
  }

  #adopt(info: SessionInfo): void {
    this.#sessionId = info.id;
    this.#model = info.model ?? null;
  }

  /** 把 BaoCut 的 MCP 服务登记到这个 serve 进程（只在内存里，不写 OpenCode 的配置文件），等到连上。 */
  async #connectMcp(options: CreateSessionOptions, timeoutMs: number): Promise<void> {
    const servers = Object.entries(options.mcpServers ?? {});
    if (servers.length === 0) return;
    for (const [name, spec] of servers) {
      await this.#server.request('PUT', `/api/experimental/mcp/${encodeURIComponent(name)}`, {
        location: options.cwd,
        body: {
          config: {
            type: 'remote',
            url: spec.url,
            headers: spec.headers,
            oauth: false,
            timeout: { execution: MCP_TOOL_CALL_TIMEOUT_MS },
          },
        },
      });
    }
    const deadline = Date.now() + timeoutMs;
    const waiting = new Set(servers.map(([name]) => name));
    while (waiting.size > 0) {
      const res = await this.#server.request<{ data?: Array<{ name: string; status?: { status?: string; error?: string } }> }>(
        'GET',
        '/api/mcp',
        { location: options.cwd },
      );
      for (const entry of res?.data ?? []) {
        if (!waiting.has(entry.name)) continue;
        const status = entry.status?.status;
        if (status === 'connected') waiting.delete(entry.name);
        else if (status && status !== 'pending') {
          waiting.delete(entry.name);
          this.#warn(DriversOpencode.mcpFailed({ name: OPENCODE_PRESET.name, server: entry.name, error: entry.status?.error ?? status }));
        }
      }
      if (waiting.size === 0) return;
      if (Date.now() > deadline) {
        this.#warn(DriversOpencode.mcpTimeout({ name: OPENCODE_PRESET.name, servers: [...waiting].join(', ') }));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async #putInstructions(text: string): Promise<void> {
    try {
      await this.#server.request('PUT', `/api/experimental/session/${this.#requireSession()}/instructions/entries/baocut`, {
        body: { value: text },
      });
    } catch (error) {
      if (!(error instanceof OpenCodeHttpError) || error.status !== 404) throw error;
      // 这个版本没有会话的 instructions 条目（实验接口）：退回到第一轮前面附上。
      this.#instructions = text;
    }
  }

  async startTurn(input: AgentInput, settings: TurnSettings): Promise<{ turnId: string }> {
    if (this.#closed) throw new Error(String(DriversCommon.sessionClosed({ name: OPENCODE_PRESET.name })));
    if (this.#turn) throw new Error(String(DriversCommon.turnInProgress()));
    const sessionId = this.#requireSession();
    await this.#applyMode(normalizeAgentMode(settings.accessMode));
    if (settings.model) await this.#applyModel(requireModel(settings.model, settings.effort));
    else if (settings.effort !== null && this.#model) {
      await this.#applyModel({ providerID: this.#model.providerID, id: this.#model.id, variant: settings.effort });
    }
    const body = await this.#prompt(input);
    const turnId = newId('turn');
    const turn: Turn = {
      id: turnId,
      cancelled: false,
      rejected: false,
      messages: new Map(),
      tools: new Map(),
      finished: new Set(),
      declined: new Set(),
      ending: null,
      settleTimer: null,
      submitted: Promise.resolve(),
    };
    this.#turn = turn;
    this.#instructions = null;
    this.#emit({ type: 'turn.started', turnId });
    turn.submitted = this.#server.request('POST', `/api/session/${sessionId}/prompt`, { body }).then(
      () => undefined,
      (error: unknown) => {
        // 进程退了：交给 session.exited（Harness 记成 AGENT_EXITED），这里不再报一遍。
        if (this.#server.hasExited) return this.#dropTurn(turn);
        this.#finishTurn(turn, 'failed', DriversOpencode.promptRejected({ name: OPENCODE_PRESET.name, error: message(error) }), null);
      },
    );
    return { turnId };
  }

  async steer(turnId: string, input: AgentInput): Promise<'accepted' | 'unavailable'> {
    const turn = this.#turn;
    if (!turn || turn.id !== turnId || turn.cancelled || this.#closed) return 'unavailable';
    await turn.submitted;
    if (this.#turn !== turn || turn.cancelled) return 'unavailable';
    try {
      const body = { ...(await this.#prompt(input)), delivery: 'steer' };
      await this.#server.request('POST', `/api/session/${this.#requireSession()}/prompt`, { body });
      return 'accepted';
    } catch (error) {
      this.#log.warn('OpenCode steer failed', { error: message(error) });
      return 'unavailable';
    }
  }

  async interrupt(turnId: string): Promise<InterruptReceipt> {
    const turn = this.#turn;
    if (!turn || turn.id !== turnId) return { status: 'not-running' };
    turn.cancelled = true;
    await this.#settleApprovals(turn.id, true);
    await turn.submitted;
    if (this.#turn !== turn) return { status: 'requested' };
    try {
      const res = await this.#server.request<{ interrupted?: boolean }>('POST', `/api/session/${this.#requireSession()}/interrupt`, {
        timeoutMs: 15_000,
      });
      // 没有在运行（执行刚好结束、提示词还没开始执行）：确认一下会话状态再收尾。
      if (res?.interrupted !== true) this.#scheduleSettle(turn, 0);
      return { status: 'requested' };
    } catch (error) {
      this.#log.warn('OpenCode interrupt request failed', { error: message(error) });
      return { status: 'unknown' };
    }
  }

  async respondToApproval(approvalId: Id, response: ApprovalResponse): Promise<void> {
    const pending = this.#approvals.get(approvalId);
    if (!pending) return;
    this.#approvals.delete(approvalId);
    // 「总是允许」的规则归 Harness 存；原生侧只按会话级放行处理，由这里记住，不回 OpenCode 的 always（它会写进原生的规则）。
    if (response.decision === 'accept-for-session' || response.decision === 'accept-always') this.#grants.add(pending.grantKey);
    const accept = response.decision === 'accept' || response.decision === 'accept-for-session' || response.decision === 'accept-always';
    if (!accept) this.#markRejected(pending);
    await this.#reply(pending.requestId, accept ? 'once' : 'reject');
    if (response.decision === 'cancel' && this.#turn?.id === pending.turnId) await this.interrupt(pending.turnId);
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
    return this.#sessionId ? { driverId: OPENCODE_DRIVER_ID, data: { sessionId: this.#sessionId } } : null;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const turn = this.#turn;
    if (turn?.settleTimer) clearTimeout(turn.settleTimer);
    await this.#settleApprovals(null, false);
    this.#unsubscribe?.();
    // 不删原生会话：之后还要按 id 恢复。
    await this.#server.close();
  }

  // ---- 每一轮的模式与模型 ----

  async #applyMode(mode: AgentMode): Promise<void> {
    if (mode === this.#mode) return;
    try {
      await this.#server.request('PATCH', `/api/session/${this.#requireSession()}`, { body: { permissions: permissionRules(mode) } });
      this.#mode = mode;
    } catch (error) {
      // 设不上就不开这一轮：按更宽的规则跑会越过 BaoCut 的访问模式。
      throw agentError('driver-failed', DriversOpencode.setModeFailed({ name: OPENCODE_PRESET.name, error: message(error) }), null);
    }
  }

  async #applyModel(model: { providerID: string; id: string; variant?: string }): Promise<void> {
    const current = this.#model;
    // `default` 是 OpenCode 自己的「不设强度」。
    const variant = (ref: { variant?: string } | null) => (ref?.variant && ref.variant !== 'default' ? ref.variant : null);
    if (current && current.providerID === model.providerID && current.id === model.id && variant(current) === variant(model)) return;
    try {
      await this.#server.request('POST', `/api/session/${this.#requireSession()}/model`, { body: { model } });
      this.#model = model;
    } catch (error) {
      throw agentError(
        'driver-failed',
        DriversCommon.modelSwitchFailed({ name: OPENCODE_PRESET.name, model: `${model.providerID}/${model.id}`, error: message(error) }),
        'AGENT_MODEL_UNAVAILABLE',
      );
    }
  }

  /** BaoCut 的输入 → `session.prompt` 的请求体：图片作为 data URI 文件（不支持图片时 Harness 不会传）。 */
  async #prompt(input: AgentInput): Promise<{ text: string; files?: Array<{ uri: string; name: string }> }> {
    const text = this.#instructions ? `<system-instructions>\n${this.#instructions}\n</system-instructions>\n\n${input.text}` : input.text;
    const files: Array<{ uri: string; name: string }> = [];
    for (const image of input.images ?? []) {
      const data = (await fs.readFile(image.path)).toString('base64');
      files.push({ uri: `data:${image.mimeType};base64,${data}`, name: path.basename(image.path) });
    }
    return files.length > 0 ? { text, files } : { text };
  }

  // ---- 事件流 ----

  #onEvent(event: OpenCodeEvent): void {
    if (event.type === 'server.connected') {
      this.#connected?.();
      this.#connected = null;
      return;
    }
    const data = event.data;
    if (!this.#sessionId || data.sessionID !== this.#sessionId) return;
    const turn = this.#turn;
    if (event.type === 'permission.asked') {
      this.#onPermission(data as unknown as PermissionRequest);
      return;
    }
    if (event.type === 'permission.replied') {
      // 别处（例如 OpenCode 自己的界面）答了：收起 BaoCut 这边的卡片。
      const requestId = data.requestID;
      for (const [approvalId, pending] of this.#approvals) {
        if (pending.requestId !== requestId) continue;
        this.#approvals.delete(approvalId);
        this.#emit({ type: 'approval.resolved', approvalId });
      }
      return;
    }
    if (!turn) return;
    switch (event.type) {
      case 'session.execution.started':
        turn.ending = null;
        if (turn.settleTimer) clearTimeout(turn.settleTimer);
        turn.settleTimer = null;
        return;
      case 'session.execution.succeeded':
        turn.ending = { kind: 'succeeded', error: null, reason: null };
        this.#scheduleSettle(turn, SETTLE_MS);
        return;
      case 'session.execution.failed':
        turn.ending = { kind: 'failed', error: errorMessage(data.error), reason: null };
        this.#scheduleSettle(turn, SETTLE_MS);
        return;
      case 'session.execution.interrupted':
        turn.ending = { kind: 'interrupted', error: null, reason: typeof data.reason === 'string' ? data.reason : null };
        this.#scheduleSettle(turn, SETTLE_MS);
        return;
      case 'session.text.started':
      case 'session.reasoning.started':
        this.#message(turn, data, event.type === 'session.text.started' ? 'agent-message' : 'reasoning');
        return;
      case 'session.text.delta':
      case 'session.reasoning.delta': {
        const kind = event.type === 'session.text.delta' ? 'agent-message' : 'reasoning';
        const delta = typeof data.delta === 'string' ? data.delta : '';
        if (!delta) return;
        const message = this.#message(turn, data, kind);
        message.text += delta;
        this.#emit({
          type: 'item.delta',
          turnId: turn.id,
          itemId: message.id,
          channel: kind === 'reasoning' ? 'reasoning' : 'text',
          delta,
        });
        return;
      }
      case 'session.text.ended':
      case 'session.reasoning.ended': {
        const kind = event.type === 'session.text.ended' ? 'agent-message' : 'reasoning';
        const message = this.#message(turn, data, kind);
        if (typeof data.text === 'string') message.text = data.text;
        turn.messages.delete(messageKey(data, kind));
        this.#emit({ type: 'item.completed', turnId: turn.id, item: { kind, id: message.id, text: message.text } });
        return;
      }
      case 'session.tool.input.started':
      case 'session.tool.called': {
        const id = typeof data.id === 'string' ? data.id : null;
        if (!id) return;
        const tool = turn.tools.get(id) ?? this.#newTool(turn, id, typeof data.name === 'string' ? data.name : 'tool');
        if (record(data.input)) tool.input = record(data.input);
        this.#emit({ type: 'item.started', turnId: turn.id, item: toolItem(tool, this.#cwd, this.#mcpNames) });
        return;
      }
      case 'session.tool.success':
      case 'session.tool.failed': {
        const id = typeof data.id === 'string' ? data.id : null;
        if (!id || turn.finished.has(id)) return;
        const tool = turn.tools.get(id) ?? this.#newTool(turn, id, 'tool');
        tool.content = contentText(data.content);
        tool.metadata = record(data.metadata);
        tool.endedAt = Date.now();
        if (event.type === 'session.tool.success') tool.status = 'completed';
        else {
          tool.status = turn.declined.has(id) ? 'declined' : 'failed';
          tool.error = errorMessage(data.error);
        }
        turn.finished.add(id);
        this.#emit({ type: 'item.completed', turnId: turn.id, item: toolItem(tool, this.#cwd, this.#mcpNames) });
        return;
      }
      case 'session.retry.scheduled': {
        const reason: DriverText = errorMessage(data.error) ?? DriversOpencode.retryFallback();
        this.#emit({ type: 'session.error', turnId: turn.id, message: String(reason), ...refField('messageRef', reason), willRetry: true });
        return;
      }
      default:
        return;
    }
  }

  #message(turn: Turn, data: Record<string, unknown>, kind: OpenMessage['kind']): OpenMessage {
    const key = messageKey(data, kind);
    let message = turn.messages.get(key);
    if (!message) {
      message = { id: newId('item'), kind, text: '' };
      turn.messages.set(key, message);
    }
    return message;
  }

  #newTool(turn: Turn, id: string, name: string): ToolState {
    const tool: ToolState = {
      id,
      name,
      input: null,
      status: 'running',
      content: null,
      metadata: null,
      error: null,
      startedAt: Date.now(),
      endedAt: null,
    };
    turn.tools.set(id, tool);
    return tool;
  }

  #onPermission(request: PermissionRequest): void {
    const turn = this.#turn;
    if (!turn || turn.cancelled || this.#closed) {
      // 回合之外（或已在取消）的请求没人来批：拒绝。
      void this.#reply(request.id, 'reject');
      return;
    }
    if ([...this.#approvals.values()].some((p) => p.requestId === request.id)) return;
    const { request: approval, grantKey, escalation } = approvalOf(request, this.#cwd);
    if (this.#grants.has(grantKey)) {
      void this.#reply(request.id, 'once');
      return;
    }
    const approvalId = newId('appr');
    const toolId = typeof request.source?.id === 'string' ? request.source.id : null;
    this.#approvals.set(approvalId, { turnId: turn.id, requestId: request.id, toolId, grantKey });
    this.#emit({ type: 'approval.requested', turnId: turn.id, approvalId, request: approval, ...(escalation ? { escalation: true } : {}) });
  }

  async #reply(requestId: string, decision: 'once' | 'reject'): Promise<void> {
    if (!this.#sessionId || this.#server.hasExited) return;
    try {
      await this.#server.request('POST', `/api/session/${this.#sessionId}/permission/${encodeURIComponent(requestId)}/reply`, {
        body: { decision },
      });
    } catch (error) {
      this.#log.warn('Replying to an OpenCode permission request failed', { error: message(error) });
    }
  }

  #markRejected(pending: PendingApproval): void {
    const turn = this.#turn;
    if (!turn || turn.id !== pending.turnId) return;
    turn.rejected = true;
    if (pending.toolId) turn.declined.add(pending.toolId);
  }

  /** 执行结束（或中断没有命中）之后：稍等片刻，确认会话不再运行再收尾；期间开始了新的执行就继续这一轮。 */
  #scheduleSettle(turn: Turn, delayMs: number): void {
    if (turn.settleTimer) clearTimeout(turn.settleTimer);
    turn.settleTimer = setTimeout(() => {
      turn.settleTimer = null;
      void this.#settle(turn);
    }, delayMs);
  }

  async #settle(turn: Turn): Promise<void> {
    if (this.#turn !== turn || this.#closed) return;
    try {
      const res = await this.#server.request<{ data?: Record<string, unknown> }>('GET', '/api/session/active');
      if (this.#turn !== turn || turn.settleTimer) return;
      if (this.#sessionId && res?.data?.[this.#sessionId]) {
        // 还在运行：等它的执行事件。
        if (!turn.ending) return;
        this.#scheduleSettle(turn, SETTLE_MS * 4);
        return;
      }
    } catch (error) {
      if (this.#server.hasExited) return;
      this.#log.warn('Querying OpenCode session status failed', { error: message(error) });
    }
    const ending = turn.ending;
    if (turn.cancelled) return this.#finishTurn(turn, 'interrupted', null, null);
    if (!ending) return this.#finishTurn(turn, 'completed', null, null);
    switch (ending.kind) {
      case 'succeeded':
        return this.#finishTurn(turn, 'completed', null, null);
      case 'failed':
        return this.#finishTurn(turn, 'failed', ending.error ?? DriversOpencode.runFailed({ name: OPENCODE_PRESET.name }), null);
      case 'interrupted':
        if (ending.reason === 'shutdown' && turn.rejected) {
          this.#warn(DriversOpencode.endedAfterRejection({ name: OPENCODE_PRESET.name }));
          return this.#finishTurn(turn, 'completed', null, null);
        }
        if (ending.reason !== 'user') {
          this.#warn(DriversOpencode.interruptedTurn({ name: OPENCODE_PRESET.name, reason: ending.reason ?? DriversCommon.unknownReason() }));
        }
        return this.#finishTurn(turn, 'interrupted', null, null);
    }
  }

  #finishTurn(turn: Turn, outcome: 'completed' | 'interrupted' | 'failed', error: DriverText | null, code: AgentErrorCode | null): void {
    if (this.#turn !== turn) return;
    if (turn.settleTimer) clearTimeout(turn.settleTimer);
    turn.settleTimer = null;
    for (const message of turn.messages.values()) {
      this.#emit({ type: 'item.completed', turnId: turn.id, item: { kind: message.kind, id: message.id, text: message.text } });
    }
    turn.messages.clear();
    // 回合结束时还没有终态的步骤：被拒的记成 declined，别的不能当成完成。
    for (const [id, tool] of turn.tools) {
      if (turn.finished.has(id)) continue;
      turn.finished.add(id);
      tool.status = turn.declined.has(id) ? 'declined' : 'interrupted';
      this.#emit({ type: 'item.completed', turnId: turn.id, item: toolItem(tool, this.#cwd, this.#mcpNames) });
    }
    void this.#settleApprovals(turn.id, false);
    this.#turn = null;
    this.#emit({ type: 'turn.completed', turnId: turn.id, outcome, error: textOf(error), ...refField('errorRef', error), errorCode: code });
  }

  #dropTurn(turn: Turn): void {
    if (turn.settleTimer) clearTimeout(turn.settleTimer);
    if (this.#turn === turn) this.#turn = null;
  }

  /** 挂着的审批收起（`reject` 为 true 时同时回原生侧拒绝）。`turnId` 为 null 时全部。 */
  async #settleApprovals(turnId: string | null, reject: boolean): Promise<void> {
    const replies: Promise<void>[] = [];
    for (const [approvalId, pending] of this.#approvals) {
      if (turnId !== null && pending.turnId !== turnId) continue;
      this.#approvals.delete(approvalId);
      if (reject) replies.push(this.#reply(pending.requestId, 'reject'));
      this.#emit({ type: 'approval.resolved', approvalId });
    }
    await Promise.all(replies);
  }

  async #onStreamClosed(error: DriverText | null): Promise<void> {
    if (this.#closed || this.#server.hasExited) return;
    // 进程退出时事件流往往先断：稍等一下，是退出就按退出报（原因更准）。
    await Promise.race([this.#server.exited, new Promise((resolve) => setTimeout(resolve, 1_000).unref())]);
    if (this.#closed || this.#server.hasExited) return;
    // 事件流断了就收不到回合的进展：当作智能体退出，结束 serve（随后发 session.exited）。
    this.#log.warn('OpenCode event stream disconnected', { error: textOf(error) });
    this.#streamError = DriversOpencode.streamLost({ error: error ?? DriversCommon.unknownReason() });
    void this.#server.close();
  }

  #streamError: DriverText | null = null;

  #onExit(reason: DriverText | null): void {
    void this.#settleApprovals(null, false);
    const turn = this.#turn;
    if (turn) this.#dropTurn(turn);
    this.#unsubscribe?.();
    const error = this.#closed ? null : (this.#streamError ?? reason ?? DriversOpencode.serveExited());
    this.#emit({ type: 'session.exited', error: textOf(error), ...refField('errorRef', error) });
  }

  #requireSession(): string {
    if (!this.#sessionId) throw new Error(String(DriversCommon.sessionNotReady({ name: OPENCODE_PRESET.name })));
    return this.#sessionId;
  }

  #warn(message: DriverText): void {
    this.#emit({ type: 'session.warning', message: String(message), ...refField('messageRef', message) });
  }

  #emit(event: AgentEvent): void {
    // 开会话期间的提示（恢复失败、MCP 连不上）在 Harness 订阅之前发出：先存着，订阅时补发。
    if (this.#early) {
      this.#early.push(event);
      return;
    }
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        this.#log.error('AgentEvent listener threw', { error: String(error) });
      }
    }
  }
}

interface SessionInfo {
  id: string;
  model?: { providerID: string; id: string; variant?: string };
}

function readSessionId(handle: AgentPersistenceHandle | null): string | null {
  if (!handle || handle.driverId !== OPENCODE_DRIVER_ID) return null;
  const data = handle.data as { sessionId?: unknown } | null;
  return typeof data?.sessionId === 'string' ? data.sessionId : null;
}

function requireModel(id: string, effort: string | null): { providerID: string; id: string; variant?: string } {
  const ref = modelRef(id, effort);
  if (!ref)
    throw agentError('driver-failed', DriversOpencode.modelFormat({ name: OPENCODE_PRESET.name, id }), 'AGENT_MODEL_UNAVAILABLE');
  return ref;
}

function messageKey(data: Record<string, unknown>, kind: OpenMessage['kind']): string {
  return `${String(data.assistantMessageID)}:${kind}:${String(data.ordinal ?? 0)}`;
}

function errorMessage(error: unknown): string | null {
  const entry = record(error);
  return typeof entry?.message === 'string' ? entry.message : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, ms: number, text: (seconds: string) => DriverText): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(String(text(String(Math.round(ms / 1000)))))), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error as Error);
      },
    );
  });
}
