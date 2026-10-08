import { RpcError, newId, nowIso, type EditorContext, type Id, type VideoRef } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { mergeDraft, pickHandoff } from '../../model/ai-tools-handoff.ts';
import { enqueueMessage } from '../../model/message-queue.ts';
import { targetKey, workspaceKey } from '../../model/workspace.ts';
import { drainQueue } from '../../runtime/message-queue-runner.ts';
import type { RuntimeSession } from '../../runtime/session.ts';
import { captureEditorContext } from '../../state/agent-context.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { routeVideo, useShell } from '../../state/shell-store.ts';
import { AI_TOOLS_COPY as C } from './ai-tools-copy.ts';

/**
 * 发到会话里；会话正忙（或前面还排着话）就排到队尾，等这一轮结束按顺序发（同会话页的输入框）。
 * 别的错误抛给调用方。
 */
export async function sendOrQueue(
  runtime: RuntimeSession,
  conversationId: Id,
  text: string,
  context: EditorContext | null,
): Promise<'sent' | 'queued'> {
  const enqueue = () =>
    useShell.getState().setQueue(conversationId, (queue) =>
      enqueueMessage(queue, {
        id: newId('queue'),
        text,
        attachments: [],
        ...(context ? { context } : {}),
        queuedAt: nowIso(),
      }),
    );
  const busy = (useDirectory.getState().conversations.find((c) => c.id === conversationId)?.activeTaskId ?? null) !== null;
  if (busy || useShell.getState().queues[conversationId]?.length) {
    enqueue();
    if (!busy) void drainQueue(runtime, conversationId);
    return 'queued';
  }
  try {
    await runtime.send(conversationId, text, context ?? undefined);
    return 'sent';
  } catch (error) {
    // 刚好有任务开跑（别的窗口、别的入口）：这句话排队，不丢。
    if (!(error instanceof RpcError && error.code === 'busy')) throw error;
    enqueue();
    return 'queued';
  }
}

/**
 * 交给 Agent（原型 `sendToAgent`）：设置态就是确认，把这句话**直接发到**这个视频的会话里。
 * Space 里打开的视频发到右下角那条悬浮会话（没有就新建、最小化了就展开），人留在编辑器；
 * Home 里发到左侧的会话（会话怎么挑见 `pickHandoff`），视频标签留着、会话露出来。会话正忙时排队。
 */
export async function handToAgent(runtime: RuntimeSession, video: VideoRef | null, text: string): Promise<boolean> {
  const shell = useShell.getState();
  const { route } = shell;
  const shown = routeVideo(route);
  const floating = route.tab === 'space' && shown ? targetKey(shown) : null;
  const plan = pickHandoff({
    source: video?.source ?? null,
    current: route.tab === 'home' ? route.conversationId : floating ? (shell.videoChats[floating] ?? null) : null,
    conversations: useDirectory.getState().conversations,
  });
  if (plan.kind === 'none') {
    ToastQueue.negative(C.noConversation, { timeout: 5000 });
    return false;
  }
  // 编辑器此刻的状态在建会话、换位置之前取：版本、选区与播放头是按下按钮那一刻的。
  const scope = { projectId: video?.source?.projectId ?? null };
  let conversationId: Id;
  if (plan.kind === 'create') {
    try {
      conversationId = (await runtime.createConversation(plan.projectId)).id;
    } catch (error) {
      ToastQueue.negative(C.createFailed(error instanceof Error ? error.message : String(error)), { timeout: 5000 });
      return false;
    }
  } else conversationId = plan.conversationId;
  const context = captureEditorContext({ ...scope, conversationId });

  if (floating) {
    useShell.getState().setVideoChat(floating, conversationId);
    useShell.getState().setVideoChatMin(false);
  } else {
    // 建会话要等一会儿：以那时的位置为准。项目起始页上开着的标签带到新会话（同首页发出第一句时）。
    const now = useShell.getState().route;
    const target = routeVideo(now);
    if (plan.kind === 'create' && now.tab === 'home' && now.conversationId === null) {
      useShell.getState().carryWorkspace(workspaceKey(null, now.projectId), conversationId);
    }
    if (target) useShell.getState().openPane({ kind: 'video', target }, { conversationId });
    else useShell.getState().go({ tab: 'home', conversationId, projectId: null });
    // 会话得露出来：完整视图退回分屏；窄窗口选中会话标签（用户自己点的交给 AI，不算智能体抢界面）。
    useShell.getState().revealConversation();
  }
  try {
    const result = await sendOrQueue(runtime, conversationId, text, context);
    ToastQueue.info(result === 'sent' ? C.sent : C.queued, { timeout: 5000 });
    return true;
  } catch (error) {
    // 没发出去：话放进那条会话的输入框，不吞掉。
    useShell.getState().setDraft(conversationId, mergeDraft(useShell.getState().drafts[conversationId], text));
    ToastQueue.negative(C.sendFailed(error instanceof Error ? error.message : String(error)), { timeout: 5000 });
    return false;
  }
}
