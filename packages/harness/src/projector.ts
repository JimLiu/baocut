import {
  clampOutput,
  nowIso,
  newId,
  refOf,
  type AgentErrorCode,
  type Id,
  type Localized,
  type MessageRef,
  type TaskStatus,
  type TimelineItem,
} from '@baocut/protocol';
import { HarnessRuns as H } from '@baocut/protocol/messages/harness';
import type { AgentEvent, AgentItem, TurnOutcome } from './driver.ts';
import type { ConversationState } from './conversation-state.ts';

/** 一次执行尝试（Run）在 Runtime 里的易失状态（架构设计 §1.5、D03）。 */
export interface RunContext {
  taskId: Id;
  runGeneration: number;
  turnId: string | null;
  /** 停止屏障已建立：不再批准任何调用（D04）。 */
  stopRequested: boolean;
  /**
   * 这一轮里 `session.error` 带来的结构化原因，后到的覆盖先到的。回合失败而结束事件没带原因时用它，
   * 原生进程意外退出时也用它；回合成功结束时不用（带 `willRetry` 的错误可能已经重试成功了）。
   */
  errorCode?: AgentErrorCode | null;
}

/** 投影之后需要 Harness 处理的后续动作。 */
export type ProjectionSignal =
  | { type: 'none' }
  | { type: 'turn-finished'; outcome: TurnOutcome; error: string | Localized | null; errorCode: AgentErrorCode | null }
  | { type: 'approval-blocked'; approvalId: Id }
  | { type: 'session-exited'; error: string | Localized | null };

/**
 * 文字与它的消息引用合成一条 `Localized`（没有引用时照原样）：Driver 事件里分开的 `message` / `messageRef` 经它进条目，
 * 也能作为嵌套参数放进别的文案。
 */
export function withRef(text: string, ref: MessageRef | null | undefined): string | Localized {
  return ref ? { ...refOf(ref), text, toString: () => text } : text;
}

const NONE: ProjectionSignal = { type: 'none' };

/**
 * ConversationProjector（架构设计 §11.3）：把 Driver 事件投影成会话条目。
 * 卡片状态只来自事件，不从模型的自然语言推断。
 */
export function projectAgentEvent(state: ConversationState, run: RunContext | null, event: AgentEvent): ProjectionSignal {
  const taskId = run?.taskId ?? null;
  switch (event.type) {
    case 'turn.started':
      if (run) run.turnId = event.turnId;
      return NONE;

    case 'item.started':
    case 'item.completed': {
      const item = toTimelineItem(state, itemKey(event.turnId, event.item.id), event.item, taskId, event.type === 'item.completed');
      if (item) state.upsert(item);
      return NONE;
    }

    case 'item.delta': {
      const key = itemKey(event.turnId, event.itemId);
      if (!state.item(key)) {
        if (event.channel === 'output') return NONE;
        state.upsert({
          kind: event.channel === 'reasoning' ? 'reasoning' : 'agent-message',
          id: key,
          createdAt: nowIso(),
          taskId,
          text: '',
          streaming: true,
        });
      }
      state.append(key, event.channel === 'output' ? 'output' : 'text', event.delta);
      return NONE;
    }

    case 'approval.requested': {
      const blocked = run?.stopRequested === true;
      state.upsert({
        kind: 'approval',
        id: `approval/${event.approvalId}`,
        createdAt: nowIso(),
        taskId,
        approvalId: event.approvalId,
        request: event.request,
        status: blocked ? 'cancelled' : 'pending',
        decidedAt: blocked ? nowIso() : null,
      });
      if (blocked) return { type: 'approval-blocked', approvalId: event.approvalId };
      state.updateConversation({ activity: 'awaiting-approval' });
      return NONE;
    }

    case 'approval.resolved': {
      const item = state.item(`approval/${event.approvalId}`);
      if (item?.kind === 'approval' && item.status === 'pending') {
        state.upsert({ ...item, status: 'cancelled', decidedAt: nowIso() });
        refreshActivity(state);
      }
      return NONE;
    }

    case 'session.warning':
      addNotice(state, taskId, 'warning', withRef(event.message, event.messageRef));
      return NONE;

    case 'session.error':
      if (run && event.code) run.errorCode = event.code;
      addNotice(
        state,
        taskId,
        event.willRetry ? 'warning' : 'error',
        event.willRetry ? H.retrying({ message: withRef(event.message, event.messageRef) }) : withRef(event.message, event.messageRef),
      );
      return NONE;

    case 'turn.completed':
      return {
        type: 'turn-finished',
        outcome: event.outcome,
        error: event.error === null ? null : withRef(event.error, event.errorRef),
        errorCode: event.errorCode ?? null,
      };

    case 'session.exited':
      return { type: 'session-exited', error: event.error === null ? null : withRef(event.error, event.errorRef) };
  }
}

/** 结束任务：收起所有未完成的条目，写入任务终态，会话回到空闲或失败。 */
export function finishTask(
  state: ConversationState,
  run: RunContext,
  status: TaskStatus,
  error: string | Localized | null,
  errorCode: AgentErrorCode | null = null,
): void {
  for (const item of state.items()) {
    if (item.taskId !== run.taskId) continue;
    if ((item.kind === 'agent-message' || item.kind === 'reasoning') && item.streaming) {
      state.upsert({ ...item, streaming: false });
    } else if (item.kind === 'tool-call' && item.status === 'running') {
      state.upsert({ ...item, status: 'interrupted' });
    } else if (item.kind === 'approval' && item.status === 'pending') {
      state.upsert({ ...item, status: 'cancelled', decidedAt: nowIso() });
    }
  }
  const task = state.item(run.taskId);
  if (task?.kind === 'task') {
    const { errorRef: _stale, ...rest } = task;
    state.upsert({
      ...rest,
      status,
      endedAt: nowIso(),
      error: error === null ? null : String(error),
      ...(error !== null && typeof error !== 'string' ? { errorRef: refOf(error) } : {}),
      ...(errorCode ? { errorCode } : {}),
    });
  }
  // 结束的任务等用户看过才算读过；正在看这个会话的界面会立刻标为已读。
  state.updateConversation({ activity: status === 'failed' ? 'failed' : 'idle', activeTaskId: null, unread: true });
}

/** 会话的活动状态由条目重新汇总：有待批的审批就是「等待批准」。 */
export function refreshActivity(state: ConversationState): void {
  const conv = state.conversation;
  if (!conv.activeTaskId) return;
  if (conv.activity === 'stopping') return;
  const waiting = state.items().some((i) => i.kind === 'approval' && i.status === 'pending' && i.taskId === conv.activeTaskId);
  const activity = waiting ? 'awaiting-approval' : 'running';
  if (conv.activity !== activity) state.updateConversation({ activity });
}

/** 会话里的一条提示。BaoCut 自己写的给 `Localized`（带上引用，界面按当前语言重新生成），Agent 的原话给字符串。 */
export function addNotice(state: ConversationState, taskId: Id | null, level: 'info' | 'warning' | 'error', text: string | Localized): void {
  const ref = typeof text === 'string' ? null : refOf(text);
  state.upsert({ kind: 'notice', id: newId('note'), createdAt: nowIso(), taskId, level, text: String(text), ...(ref ? { textRef: ref } : {}) });
}

function itemKey(turnId: string, itemId: string): Id {
  return `${turnId || 'turn'}/${itemId}`;
}

function toTimelineItem(
  state: ConversationState,
  id: Id,
  item: AgentItem,
  taskId: Id | null,
  completed: boolean,
): TimelineItem | null {
  const existing = state.item(id);
  const createdAt = existing?.createdAt ?? nowIso();
  switch (item.kind) {
    case 'agent-message':
    case 'reasoning': {
      // 完成事件带全文；开始事件可能是空的，此时保留已经流式到达的文字。
      const prior = existing && (existing.kind === 'agent-message' || existing.kind === 'reasoning') ? existing.text : '';
      const text = completed ? item.text || prior : prior || item.text;
      return { kind: item.kind, id, createdAt, taskId, text, streaming: !completed };
    }
    case 'tool-call': {
      const priorOutput = existing?.kind === 'tool-call' ? existing.output : '';
      return {
        kind: 'tool-call',
        id,
        createdAt,
        taskId,
        tool: item.tool,
        title: item.title,
        detail: item.detail,
        output: clampOutput(item.output ?? priorOutput),
        status: completed && item.status === 'running' ? 'completed' : item.status,
        exitCode: item.exitCode,
        durationMs: item.durationMs,
      };
    }
    case 'user-message':
    case 'other':
      return null;
  }
}
