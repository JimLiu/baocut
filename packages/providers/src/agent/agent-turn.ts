import type { AgentDriver, AgentSession } from '@baocut/harness';
import { ProviderFailure } from '@baocut/models';
import type { ProviderUnavailableReason } from '@baocut/protocol';
import { ProvidersAgent as PA } from '@baocut/protocol/messages/providers';

/** 执行前的复核：启用了、Driver 可用、版本够。 */
export type AgentReadiness =
  | {
      ok: true;
      driver: AgentDriver;
      version: string;
      /** 用户手动指定的可执行文件；null 由 Driver 自己找。 */
      executable?: string | null;
      /** 这次探测到的账号是不是订阅（Codex 是 ChatGPT 登录）：是时用量记为订阅内（§6.9、§6.10）。 */
      subscribed: boolean;
    }
  | { ok: false; reason: ProviderUnavailableReason; message: string };

/** 错误说明里带上的回复摘录（不是输出，只帮用户看懂为什么失败）。 */
const REPLY_EXCERPT = 300;

export type AgentTurnResult =
  | { kind: 'completed' }
  | { kind: 'failed'; message: string }
  | { kind: 'interrupted' }
  | { kind: 'exited'; message: string }
  | { kind: 'timeout' }
  | { kind: 'cancelled' };

export interface AgentTurnOutcome {
  result: AgentTurnResult;
  /** 智能体的文字回复（去掉首尾空白，空的不收），按到达顺序。 */
  replies: string[];
  /** 被拒绝的审批请求数。 */
  declined: number;
}

/** 受限会话的模型与推理强度（原生 id）；null 不传，用 Agent 自己的默认（CLI 配置里的模型、模型自己的默认强度）。 */
export interface AgentModelSettings {
  model: string | null;
  effort: string | null;
}

/** 生图不指定模型与强度。 */
export const AGENT_DEFAULT_SETTINGS: AgentModelSettings = { model: null, effort: null };

/** 开一个受限的专用会话（§6.9）：只写工作目录，不给 MCP 服务；模型与强度按 `settings`，不给时用 Agent 自己的默认。 */
export function openConfinedSession(
  ready: Extract<AgentReadiness, { ok: true }>,
  cwd: string,
  developerInstructions: string,
  settings: AgentModelSettings = AGENT_DEFAULT_SETTINGS,
): Promise<AgentSession> {
  return ready.driver.createSession({
    cwd,
    // 受限会话（confinement）的策略固定，访问模式不起作用。
    accessMode: 'fullAccess',
    model: settings.model,
    effort: settings.effort,
    executable: ready.executable ?? null,
    resume: null,
    developerInstructions,
    confinement: 'cwd-write-only',
  });
}

/**
 * 发一个回合，等它结束、失败、会话退出、超时或取消。取消与超时时请求中断（会话随后由调用方关闭）。
 * `settings` 与开会话时的相同（回合上再带一次，免得原生侧回到默认）。
 */
export async function runAgentTurn(
  session: AgentSession,
  text: string,
  signal: AbortSignal,
  timeoutMs: number,
  settings: AgentModelSettings = AGENT_DEFAULT_SETTINGS,
): Promise<AgentTurnOutcome> {
  const replies: string[] = [];
  const errors: string[] = [];
  let declined = 0;
  let settle!: (result: AgentTurnResult) => void;
  const done = new Promise<AgentTurnResult>((resolve) => (settle = resolve));
  const unsubscribe = session.subscribe((event) => {
    switch (event.type) {
      case 'item.completed':
        if (event.item.kind === 'agent-message' && event.item.text.trim()) replies.push(event.item.text.trim());
        return;
      case 'approval.requested':
        // 没有人来批：越界的动作一律拒绝。
        declined++;
        void session.respondToApproval(event.approvalId, { decision: 'decline' }).catch(() => {});
        return;
      case 'session.error':
        if (!event.willRetry) errors.push(event.message);
        return;
      case 'turn.completed':
        if (event.outcome === 'completed') settle({ kind: 'completed' });
        else if (event.outcome === 'interrupted') settle({ kind: 'interrupted' });
        else settle({ kind: 'failed', message: event.error ?? errors.at(-1) ?? PA.unknownError().text });
        return;
      case 'session.exited':
        settle({ kind: 'exited', message: event.error ?? errors.at(-1) ?? PA.processExited().text });
        return;
      default:
        return;
    }
  });
  const onAbort = () => settle({ kind: 'cancelled' });
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => settle({ kind: 'timeout' }), timeoutMs);
  let turnId: string | null = null;
  try {
    if (signal.aborted) return { result: { kind: 'cancelled' }, replies, declined };
    try {
      turnId = (await session.startTurn({ text }, { accessMode: 'fullAccess', model: settings.model, effort: settings.effort })).turnId;
    } catch (error) {
      settle({ kind: 'exited', message: PA.turnNotStarted({ error: messageOf(error) }).text });
    }
    const result = await done;
    if ((result.kind === 'cancelled' || result.kind === 'timeout') && turnId) await session.interrupt(turnId).catch(() => {});
    return { result, replies, declined };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    unsubscribe();
  }
}

/** 没有正常完成的回合 → `ProviderFailure`（超时、退出、失败、中断）。`completed` 与 `cancelled` 由调用方处理，这里返回 null。 */
export function turnFailure(
  result: AgentTurnResult,
  facts: { label: string; providerId: string; declined: number; timeoutMs: number },
): ProviderFailure | null {
  const { label, timeoutMs } = facts;
  const details = { providerId: facts.providerId, ...(facts.declined > 0 ? { declinedApprovals: facts.declined } : {}) };
  switch (result.kind) {
    case 'cancelled':
    case 'completed':
      return null;
    case 'timeout':
      return new ProviderFailure('unavailable-remote', PA.timedOut({ label, minutes: Math.round(timeoutMs / 60_000) }).text, {
        ...details,
        reason: 'timeout',
      });
    case 'exited':
      return new ProviderFailure('unavailable-remote', PA.exited({ label, message: result.message }).text, { ...details, reason: 'exited' });
    case 'failed':
    case 'interrupted':
      return new ProviderFailure(
        'rejected',
        PA.notCompleted({ label, reason: result.kind === 'failed' ? result.message : PA.turnInterrupted() }).text,
        { code: 'PROVIDER_REJECTED', ...details, reason: result.kind === 'failed' ? 'turn-failed' : 'turn-interrupted' },
      );
  }
}

export function excerpt(text: string): string {
  const chars = [...text.trim()];
  return chars.length > REPLY_EXCERPT ? `${chars.slice(0, REPLY_EXCERPT).join('')}…` : chars.join('');
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
