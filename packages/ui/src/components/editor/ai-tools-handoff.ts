import {
  RpcError,
  newId,
  nowIso,
  type AgentMode,
  type AttachmentRef,
  type DriverId,
  type EditorContext,
  type Id,
  type SkillSendRef,
  type VideoRef,
} from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { mergeDraft, planHandoff } from '../../model/ai-tools-handoff.ts';
import { sendFailureMessage } from '../../model/agent-skills.ts';
import { enqueueMessage } from '../../model/message-queue.ts';
import { targetKey, workspaceKey } from '../../model/workspace.ts';
import { setDefaultAccessMode } from '../../runtime/agent-commands.ts';
import { drainQueue } from '../../runtime/message-queue-runner.ts';
import type { RuntimeSession } from '../../runtime/session.ts';
import { captureEditorContext } from '../../state/agent-context.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useDraftImages } from '../../state/draft-images-store.ts';
import { useDraftSkills } from '../../state/draft-skills-store.ts';
import { routeVideo, useShell } from '../../state/shell-store.ts';
import { AI_TOOLS_COPY as C } from './ai-tools-copy.ts';

/** 一句要发出去的话：正文、已经上传完的附件与挂着的 skill。 */
export interface OutgoingMessage {
  text: string;
  attachments: AttachmentRef[];
  skills: SkillSendRef[];
}

/**
 * 发到会话里；会话正忙（或前面还排着话）就排到队尾，等这一轮结束按顺序发（同会话页的输入框）。
 * 别的错误抛给调用方。
 */
export async function sendOrQueue(
  runtime: RuntimeSession,
  conversationId: Id,
  message: OutgoingMessage,
  context: EditorContext | null,
): Promise<'sent' | 'queued'> {
  const { text, attachments } = message;
  const skill = message.skills[0];
  const enqueue = () =>
    useShell.getState().setQueue(conversationId, (queue) =>
      enqueueMessage(queue, {
        id: newId('queue'),
        text,
        attachments,
        ...(context ? { context } : {}),
        ...(skill ? { skill } : {}),
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
    await runtime.send(
      conversationId,
      text,
      context ?? undefined,
      attachments.map((a) => a.id),
      undefined,
      skill,
    );
    return 'sent';
  } catch (error) {
    // 刚好有任务开跑（别的窗口、别的入口）：这句话排队，不丢。
    if (!(error instanceof RpcError && error.code === 'busy')) throw error;
    enqueue();
    return 'queued';
  }
}

/** 交给 Agent 的一次请求（产品设计 §5.10「交给智能体」）。 */
export interface HandoffRequest extends OutgoingMessage {
  video: VideoRef | null;
  /** 「会话」行选的：新开一条，或接着这一条。 */
  session: 'new' | { id: Id };
  /** 新会话：只带这页上选过的访问模式与 Agent · 模型 · 强度，没选的由 Runtime 按偏好给（同悬浮会话）。 */
  create?: { accessMode?: AgentMode; driverId?: DriverId; model?: string | null; effort?: string | null };
  /** 提示词框的草稿键：没发出去时附件从这里挪到那条会话的输入框。 */
  draftKey: string;
}

/**
 * 交给 Agent（原型 tool-prompt.jsx `onStart` → `sendToAgent`）：参数页就是确认，按「会话」行新开一条会话（缺省）或接着这个视频
 * 当前的那条，把提示词框里的话连同附件与挂着的 skill **直接发出去**；接着的那条正忙时排队。会话在左、这个视频作为功能区的标签留在
 * 右边，会话露出来；从 Space 打开的视频同样转到 Home（悬浮会话只是新会话的输入框，不显示会话，产品设计 §5.1）。
 * 返回 false：没发出去，提示词框原样留着。会话已经建好、话没发出去时，话、附件与 skill 放进那条会话的输入框，也算交出去了。
 */
export async function handToAgent(runtime: RuntimeSession, request: HandoffRequest): Promise<boolean> {
  const { video, session, create, draftKey } = request;
  const source = video?.source ?? null;
  const plan = planHandoff({ session, source, conversations: useDirectory.getState().conversations });
  if (plan.kind === 'none') {
    ToastQueue.negative(C.noConversation, { timeout: 5000 });
    return false;
  }
  const shell = useShell.getState();
  const shown = routeVideo(shell.route);
  const floating = shell.route.tab === 'space' && shown ? targetKey(shown) : null;
  const scope = { projectId: source?.projectId ?? null };
  let conversationId: Id;
  if (plan.kind === 'create') {
    try {
      conversationId = (await runtime.createConversation(plan.projectId, create ?? {})).id;
      // 选过的访问模式同时记成新会话的默认（同悬浮会话）。
      if (create?.accessMode) void setDefaultAccessMode(runtime, create.accessMode).catch(() => {});
    } catch (error) {
      ToastQueue.negative(C.createFailed(error instanceof Error ? error.message : String(error)), { timeout: 5000 });
      return false;
    }
  } else conversationId = plan.conversationId;
  // 编辑器此刻的状态：版本、选区与播放头是按下按钮那一刻的。
  const context = captureEditorContext({ ...scope, conversationId });

  // 悬浮会话记着这一条：最小化的图标按它亮状态点。
  if (floating) useShell.getState().setVideoChat(floating, conversationId);
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
  try {
    const result = await sendOrQueue(runtime, conversationId, request, context);
    ToastQueue.info(result === 'queued' ? C.queued : plan.kind === 'create' ? C.sentNew : C.sentCurrent, { timeout: 5000 });
    return true;
  } catch (error) {
    ToastQueue.negative(sendFailureMessage(error), { timeout: 5000 });
    // 没发出去：话放进那条会话的输入框（接在已有的字后面），图片与 skill 一起挪过去，不吞掉。本机文件的路径已经写在话里。
    const after = useShell.getState();
    after.setDraft(conversationId, mergeDraft(after.drafts[conversationId], request.text));
    useDraftImages.getState().move(draftKey, conversationId);
    const skill = request.skills[0];
    if (skill) useDraftSkills.getState().set(conversationId, skill.id);
    return true;
  }
}
