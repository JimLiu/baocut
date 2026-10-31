import { useCallback } from 'react';
import {
  RpcError,
  newId,
  type Id,
  type RpcMethod,
  type RpcParams,
  type RpcResult,
  type SuggestionChip,
  type TimelineItem,
  type UserWorkItemEvent,
  type WorkItem,
  type WorkItemQuestion,
} from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { chipAction } from '../../model/bot.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useShell } from '../../state/shell-store.ts';
import { useTimeline } from '../../state/timeline-store.ts';
import { focusPromptEnd } from '../focus-prompt.ts';
import { BOT_COPY as C } from './bot-copy.ts';

/**
 * Bot 页的命令（docs/design/bot-mode 技术方案 §16.1）：都是公共 RPC，界面不做乐观修改，结果经 `channels` 与
 * `work-items:<id>` 主题回来。失败时弹一句、返回 null，调用方不用各自 try。
 */
export function useBotCall() {
  const runtime = useRuntime();
  return useCallback(
    async <M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M> | null> => {
      try {
        return await runtime.client.request(method, params);
      } catch (error) {
        ToastQueue.negative(C.common.failed(errorText(error)), { timeout: 5000 });
        return null;
      }
    },
    [runtime],
  );
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isConflict(error: unknown): error is RpcError {
  return error instanceof RpcError && error.code === 'conflict';
}

/** 用户能对任务发的状态事件（`workItems.transition`）。 */
export function transitionWorkItem(call: ReturnType<typeof useBotCall>, id: Id, event: UserWorkItemEvent) {
  return call('workItems.transition', { id, event });
}

/** 把光标放进某条会话的输入框（「其他…」提示、起手提示填入后）。 */
export function focusComposer(conversationId: Id): void {
  // 草稿刚换过时输入框要等这次渲染完才拿到新值，放到下一帧。
  requestAnimationFrame(() => focusPromptEnd(document.querySelector(`[data-composer="${CSS.escape(conversationId)}"]`)));
}

/**
 * 点提示芯片（技术方案 §12.4）：`send` 发出完整的句子并带上 `via: 'suggestion'` 与芯片 id（Runtime 核验它还开着，
 * 过时的拒绝并提示）；`fill` 只填进输入框；`focus`（「其他…」）只把光标放进输入框。
 */
export async function pressChip(runtime: RuntimeSession, conversationId: Id, chip: SuggestionChip): Promise<void> {
  const action = chipAction(chip);
  if (action !== 'send') {
    if (action === 'fill') useShell.getState().setDraft(conversationId, chip.text);
    focusComposer(conversationId);
    return;
  }
  try {
    await runtime.client.request('conversations.send', {
      conversationId,
      text: chip.text,
      commandId: newId('cmd'),
      via: 'suggestion',
      suggestionChipId: chip.id,
    });
  } catch (error) {
    ToastQueue.negative(isConflict(error) ? C.chips.stale : C.common.failed(errorText(error)), { timeout: 5000 });
  }
}

type ApprovalItem = Extract<TimelineItem, { kind: 'approval' }>;

/** 线程会话里这次审批或提问的条目（线程的时间线订着时才有）。 */
export function findApproval(conversationId: Id | null, approvalId: Id): ApprovalItem | undefined {
  if (!conversationId) return undefined;
  const items = useTimeline.getState().byConversationId[conversationId]?.items ?? [];
  return items.find((item): item is ApprovalItem => item.kind === 'approval' && item.approvalId === approvalId);
}

/**
 * 回答任务上「等你的问题」的第 `index` 个选项（需求 §11.6、BOT-CH-11）：问题来自提问卡时走 `agents.answerQuestion`
 * （与在卡片上选一样）；来自报告的问题没有卡片，把选项原话作为一条消息发给线程（`via: 'notification'`：不是在对话里亲手打的）。
 * 没有线程的（用户自己的任务）不在这里答。
 */
export async function answerWorkItemQuestion(
  runtime: RuntimeSession,
  item: Pick<WorkItem, 'threadId'>,
  question: WorkItemQuestion,
  index: number,
): Promise<boolean> {
  const option = question.options[index];
  const threadId = item.threadId;
  if (!option || !threadId) return false;
  try {
    // 提问卡推出的问题带着那一问的 id：线程的时间线没订着（没打开过线程）也能直接作答；旧记录没有时再看缓存的提问卡。
    const approval = question.approvalId && !question.questionId ? findApproval(threadId, question.approvalId) : undefined;
    const askedId = question.questionId ?? (approval?.request.kind === 'question' ? approval.request.questions[0]?.id : undefined);
    if (question.approvalId && askedId) {
      await runtime.answerQuestion(threadId, question.approvalId, { [askedId]: [option.label] });
    } else {
      await runtime.client.request('conversations.send', { conversationId: threadId, text: option.label, commandId: newId('cmd'), via: 'notification' });
    }
    ToastQueue.positive(C.detail.answered, { timeout: 3000 });
    return true;
  } catch (error) {
    ToastQueue.negative(C.common.failed(errorText(error)), { timeout: 5000 });
    return false;
  }
}

/** 授权审批：允许或拒绝（`approvals.respond`），每件单独确认，没有批量。 */
export async function respondApproval(runtime: RuntimeSession, approvalId: Id, allow: boolean): Promise<void> {
  try {
    await runtime.client.request('approvals.respond', { approvalId, decision: allow ? 'allow' : 'deny' });
  } catch (error) {
    ToastQueue.negative(C.common.failed(errorText(error)), { timeout: 5000 });
  }
}

/** 一条任务的「下一步」一行（列表行、线程卡）：等你的问题、停下的原因、当前步骤。 */
export function nextLine(item: WorkItem): string | null {
  if (item.question) return item.question.text;
  if (item.status === 'active' && item.active?.reason) return item.active.reason;
  const step = item.steps.find((s) => s.state === 'active') ?? item.steps[0];
  if (step) return step.text;
  if (item.status === 'resolved' && item.outcome) return item.outcome;
  return item.description || null;
}
