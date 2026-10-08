import { expect } from 'vitest';
import type { AgentDriver, AgentEvent, AgentImage, AgentInput, AgentSession, ApprovalResponse, CreateSessionOptions } from '@baocut/harness';
import { newId, nowIso, type AgentErrorCode, type ApprovalRequest, type DriverModel, type DriverProbe } from '@baocut/protocol';

/**
 * 测试用的假原生智能体：回合开始后一直开着，测试拿着它的会话令牌、经真实的 MCP 端点替它调用工具。
 */

const capabilities: DriverProbe['capabilities'] = { steer: false, approvals: true, resume: false, images: false };

/** 一份「可用」的探测结果，给假 Driver 用。 */
export function fakeProbe(capabilitiesOverride: DriverProbe['capabilities'] = capabilities, models: DriverModel[] = []): DriverProbe {
  return {
    id: 'codex',
    name: 'Fake',
    command: 'fake',
    state: 'ready',
    status: 'available',
    version: '0',
    minVersion: '0',
    latestVersion: null,
    unavailableReason: null,
    detail: null,
    executable: null,
    realExecutable: null,
    account: null,
    plan: '',
    loginCommand: null,
    install: [],
    models,
    configModel: null,
    configModelKnown: null,
    checkedAt: nowIso(),
    verified: true,
    tested: true,
    capabilities: capabilitiesOverride,
  };
}

/** 回合开始后一直开着，直到测试调用 `finish()`；这期间测试替智能体调用工具。 */
export class ToolSession implements AgentSession {
  readonly id = newId('fake');
  readonly capabilities: DriverProbe['capabilities'];
  readonly inputs: string[] = [];
  /** 每次收到的图片（startTurn 与 steer），与 `inputs` 不一一对应。 */
  readonly images: AgentImage[][] = [];
  /** Harness 对审批的回应：自动答应的、用户点的、停止屏障取消的。 */
  readonly responses: { approvalId: string; decision: ApprovalResponse['decision'] }[] = [];
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  #turn = 0;
  turnId: string | null = null;
  readonly options: CreateSessionOptions;

  constructor(options: CreateSessionOptions, caps: DriverProbe['capabilities'] = capabilities) {
    this.options = options;
    this.capabilities = caps;
  }

  startTurn(input: AgentInput): Promise<{ turnId: string }> {
    const turnId = `turn-${++this.#turn}`;
    this.turnId = turnId;
    this.inputs.push(input.text);
    if (input.images) this.images.push(input.images);
    setTimeout(() => this.#emit({ type: 'turn.started', turnId }), 1);
    return Promise.resolve({ turnId });
  }

  async steer(_turnId: string, input: AgentInput): Promise<'accepted' | 'unavailable'> {
    if (!this.capabilities.steer) return 'unavailable';
    this.inputs.push(input.text);
    if (input.images) this.images.push(input.images);
    return 'accepted';
  }

  finish(outcome: 'completed' | 'interrupted' | 'failed' = 'completed', errorCode: AgentErrorCode | null = null) {
    if (this.turnId) {
      this.#emit({
        type: 'turn.completed',
        turnId: this.turnId,
        outcome,
        error: outcome === 'failed' ? '回合失败' : null,
        ...(errorCode ? { errorCode } : {}),
      });
    }
    this.turnId = null;
  }

  /** 原生侧送来一个审批（命令、文件修改、Agent 自带的工具），返回审批号。 */
  requestApproval(request: ApprovalRequest): string {
    const approvalId = newId('appr');
    this.#emit({ type: 'approval.requested', turnId: this.turnId ?? 'turn', approvalId, request });
    return approvalId;
  }

  /** 原生侧的其他事件（session.error 之类）。 */
  emit(event: AgentEvent) {
    this.#emit(event);
  }

  /** 中断请求先记下来，不立即结束：测试要看停止屏障与回合结束之间的那段时间。 */
  async interrupt() {
    return { status: 'requested' as const };
  }

  async respondToApproval(approvalId: string, response: ApprovalResponse) {
    this.responses.push({ approvalId, decision: response.decision });
  }

  subscribe(listener: (event: AgentEvent) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  describePersistence() {
    return null;
  }

  async close() {}

  #emit(event: AgentEvent) {
    for (const listener of this.#listeners) listener(event);
  }
}

export class ToolDriver implements AgentDriver {
  readonly id = 'codex' as const;
  readonly sessions: ToolSession[] = [];
  readonly #capabilities: DriverProbe['capabilities'];
  readonly #models: DriverModel[];

  constructor(options: { capabilities?: Partial<DriverProbe['capabilities']>; models?: DriverModel[] } = {}) {
    this.#capabilities = { ...capabilities, ...options.capabilities };
    this.#models = options.models ?? [];
  }

  async probe(): Promise<DriverProbe> {
    return fakeProbe(this.#capabilities, this.#models);
  }

  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    const session = new ToolSession(options, this.#capabilities);
    this.sessions.push(session);
    return session;
  }
}

export async function until<T>(
  read: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

let rpcId = 0;

export async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
}

/** 以这个原生会话的身份调用 MCP 方法。 */
export async function mcp(session: ToolSession, method: string, params: Record<string, unknown> = {}) {
  const server = session.options.mcpServers!.baocut!;
  const response = await post(server.url, server.headers, { jsonrpc: '2.0', id: ++rpcId, method, params });
  expect(response.status).toBe(200);
  return (await response.json()) as { result?: Record<string, unknown>; error?: { code: number; message: string } };
}

/** 工具结果的形态随工具而变，测试里按需取字段。 */
export type Loose = any;

export async function tool(session: ToolSession, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; body: Loose }> {
  const { result } = await mcp(session, 'tools/call', { name, arguments: args });
  const content = result!.content as { type: string; text: string }[];
  return { isError: Boolean(result!.isError), body: JSON.parse(content[0]!.text) };
}
