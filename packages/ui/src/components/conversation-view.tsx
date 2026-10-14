import { useEffect, useState } from 'react';
import { DEFAULT_AGENT_MODE, RpcError, newId, nowIso, type AttachmentRef, type DesignAnnotation, type DesignSystemAnnotation, type Id, type SkillSendRef, type SlideAnnotation } from '@baocut/protocol';
import { Button, ProgressCircle, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { S } from './shell-copy.ts';
import { AGENT_PICKER, QUEUE_COPY } from '../copy.ts';
import { sendFailureMessage } from '../model/agent-skills.ts';
import { enqueueMessage } from '../model/message-queue.ts';
import { sentDesignAnnotations } from '../model/design-annotations.ts';
import { DESIGN } from '../model/design-copy.ts';
import { sentDesignSystemAnnotations } from '../model/design-system-annotations.ts';
import { DESIGN_SYSTEM } from '../model/design-system-copy.ts';
import { sentSlideAnnotations } from '../model/slide-annotations.ts';
import { SLIDES } from '../model/slides-copy.ts';
import { itemKey } from '../model/workspace.ts';
import { referenceDescription } from '../model/space-actions.ts';
import { useRuntime } from '../runtime/context.tsx';
import { drainQueue, sendQueuedMessageNow } from '../runtime/message-queue-runner.ts';
import { useConversationMeta, useDirectory } from '../state/directory-store.ts';
import { useDraftDesignAnnotationList, useDraftDesignAnnotations } from '../state/draft-design-annotations-store.ts';
import { useDraftDesignSystemAnnotationList, useDraftDesignSystemAnnotations } from '../state/draft-design-system-annotations-store.ts';
import { useDraftSlideAnnotationList, useDraftSlideAnnotations } from '../state/draft-slide-annotations-store.ts';
import { flushEditors } from '../state/editor-bridge.ts';
import { useTimelineItems, useTimelineLoaded } from '../state/timeline-store.ts';
import { useSetting } from '../state/settings-store.ts';
import { useShell } from '../state/shell-store.ts';
import { Composer } from './composer.tsx';
import { QueuedMessages } from './queued-messages.tsx';
import { useEditorReference } from './use-editor-reference.ts';
import { Thread } from './thread/thread.tsx';
import { ThreadEmpty } from './thread/thread-empty.tsx';

const view = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, minWidth: 0 });
const centered = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  flexGrow: 1,
  font: 'ui',
  color: 'gray-600',
});

/** `autoFocus`：挂上时把光标放进输入框；编辑器右下角默认展开的悬浮会话不抢焦点。 */
export function ConversationView({ conversationId, autoFocus = true }: { conversationId: string; autoFocus?: boolean }) {
  const runtime = useRuntime();
  const meta = useConversationMeta(conversationId);
  // 会话没切过访问模式时跟着设置里的默认走（§3.12），设置还没到就按协议的默认。
  const defaultMode = useSetting('agent.defaultAccessMode') ?? DEFAULT_AGENT_MODE;
  const ready = useDirectory((s) => s.ready);
  const items = useTimelineItems(conversationId);
  const loaded = useTimelineLoaded(conversationId);
  const go = useShell((s) => s.go);
  // 与另一条会话共用工作目录的，来源按那条会话认（架构设计 §3.10）。
  const editor = useEditorReference({ conversationId: meta?.folderOf ?? conversationId, projectId: meta?.projectId ?? null });
  const slideAnnotations = useDraftSlideAnnotationList(conversationId);
  const designAnnotations = useDraftDesignAnnotationList(conversationId);
  const systemAnnotations = useDraftDesignSystemAnnotationList(conversationId);
  const [sendingNow, setSendingNow] = useState<Id | null>(null);

  useEffect(() => runtime.watchConversation(conversationId), [runtime, conversationId]);
  // 正在看的会话完成了就算读过：清掉「已完成未读」。
  const unread = meta?.unread ?? false;
  useEffect(() => {
    if (unread) void runtime.markRead(conversationId).catch(() => {});
  }, [runtime, conversationId, unread]);

  if (!meta) {
    return ready ? (
      <div className={centered}>
        <span>{S.conversationView.missing}</span>
        <Button variant="secondary" onPress={() => go({ tab: 'home', conversationId: null, projectId: null })}>
          {S.common.newSession}
        </Button>
      </div>
    ) : (
      <div className={centered}>
        <ProgressCircle isIndeterminate aria-label={S.common.loading} />
      </div>
    );
  }

  const busy = meta.activeTaskId !== null;
  // 有过任务的会话不能再换 Agent（原生会话不能跨 Agent 续，架构设计 §3.11）。
  const lockedTo = items.some((i) => i.kind === 'task') ? meta.driverId : null;

  /** 忙的时候发的话先排队，带上此刻的编辑器状态、点选的 skill 与幻灯片、设计稿、设计系统标注；任务结束后按顺序发出。 */
  const enqueue = async (
    text: string,
    attachments: AttachmentRef[],
    skills: SkillSendRef[],
    notes: SlideAnnotation[],
    designNotes: DesignAnnotation[],
    systemNotes: DesignSystemAnnotation[],
  ) => {
    const context = await editor.capture();
    useShell.getState().setQueue(conversationId, (queue) =>
      enqueueMessage(queue, {
        id: newId('queue'),
        text,
        attachments,
        ...(context ? { context } : {}),
        ...(skills.length ? { skills } : {}),
        ...(notes.length ? { slideAnnotations: notes } : {}),
        ...(designNotes.length ? { designAnnotations: designNotes } : {}),
        ...(systemNotes.length ? { designSystemAnnotations: systemNotes } : {}),
        queuedAt: nowIso(),
      }),
    );
    editor.reset();
  };
  const reportQueueFailure = (message: string) => ToastQueue.negative(QUEUE_COPY.failed(message), { timeout: 5000 });

  const sendNow = async (messageId: Id) => {
    setSendingNow(messageId);
    // 带 skill 的不插话（协议的 steer 不收 skill），留在队列等这一轮结束：提示说的是这个原因，不是 Agent 不支持插话。
    const withSkill = !!useShell.getState().queues[conversationId]?.find((m) => m.id === messageId)?.skills?.length;
    try {
      const result = await sendQueuedMessageNow(runtime, conversationId, messageId);
      if (result.status === 'deferred')
        ToastQueue.neutral(withSkill ? QUEUE_COPY.skillWaits : QUEUE_COPY.steerUnsupported, { timeout: 5000 });
      else if (result.status === 'failed') reportQueueFailure(result.error);
    } finally {
      setSendingNow(null);
    }
  };

  return (
    <div className={view}>
      {loaded ? (
        <Thread
          items={items}
          conversationId={conversationId}
          running={busy}
          empty={<ThreadEmpty conversationId={conversationId} projectId={meta.projectId} folderOf={meta.folderOf} />}
        />
      ) : (
        <div className={centered}>
          <ProgressCircle isIndeterminate aria-label={S.conversationView.loadingSession} />
        </div>
      )}
      <Composer
        draftKey={conversationId}
        driverId={meta.driverId}
        model={meta.model}
        effort={meta.effort}
        lockedTo={lockedTo}
        onAgentChange={(change) =>
          void runtime.updateConversation(conversationId, change).catch((error: Error) => {
            const message = error instanceof RpcError && error.code === 'conflict' ? AGENT_PICKER.locked : S.conversationView.switchFailed(error.message);
            ToastQueue.negative(message, { timeout: 5000 });
          })
        }
        accessMode={meta.accessMode ?? defaultMode}
        onAccessModeChange={(accessMode) =>
          void runtime
            .updateConversation(conversationId, { accessMode })
            .catch((error: Error) => ToastQueue.negative(S.conversationView.accessModeFailed(error.message), { timeout: 5000 }))
        }
        busy={busy}
        queueWhileBusy
        stopping={meta.activity === 'stopping'}
        placeholder={busy ? QUEUE_COPY.busyPlaceholder : S.conversationView.placeholder}
        autoFocus={autoFocus}
        reference={editor.reference}
        spaceReferences={
          meta.pendingReferences?.length
            ? {
                items: meta.pendingReferences.map((ref) => ({ id: ref.entryId, label: ref.name, description: referenceDescription(ref) })),
                onClear: () =>
                  void runtime
                    .clearPendingReferences(conversationId)
                    .catch((error: Error) => ToastQueue.negative(S.conversationView.removeFailed(error.message), { timeout: 5000 })),
              }
            : null
        }
        readScope={
          meta.spaceReadScope
            ? {
                scope: meta.spaceReadScope,
                onRemove: () =>
                  void runtime
                    .updateConversation(conversationId, { spaceReadScope: null })
                    .catch((error: Error) => ToastQueue.negative(S.conversationView.removeFailed(error.message), { timeout: 5000 })),
              }
            : null
        }
        slideAnnotations={{
          items: slideAnnotations.map((n) => ({ id: n.id, target: n.deck, anchor: n.anchor, label: n.label, text: n.text })),
          onRemove: (id) => useDraftSlideAnnotations.getState().remove(conversationId, id),
          onClear: () => useDraftSlideAnnotations.getState().clear(conversationId),
        }}
        designAnnotations={{
          items: designAnnotations.map((n) => ({ id: n.id, target: n.canvas, anchor: n.anchor, label: n.label, text: n.text })),
          onRemove: (id) => useDraftDesignAnnotations.getState().remove(conversationId, id),
          onClear: () => useDraftDesignAnnotations.getState().clear(conversationId),
        }}
        designSystemAnnotations={{
          items: systemAnnotations.map((n) => ({ id: n.id, target: n.system, anchor: n.anchor, section: n.section, label: n.label, text: n.text })),
          onRemove: (id) => useDraftDesignSystemAnnotations.getState().remove(conversationId, id),
          onClear: () => useDraftDesignSystemAnnotations.getState().clear(conversationId),
        }}
        mentionScope={{ projectId: meta.projectId, conversationId }}
        queue={<QueuedMessages conversationId={conversationId} sending={sendingNow} onSendNow={(id) => void sendNow(id)} />}
        beforeSend={async () => {
          // 带着幻灯片、设计稿或设计系统标注时，先让打开着的编辑器把改动保存完（docs/design/slides §8.2、docs/design/canvas §8.2、§10.6）：
          // 智能体读到的是用户看到的版本。等的时候输入框里的话留着；没保存成就不发，写出是哪几份（产品设计 §3.2.4），输入与标注都留着。
          const slides = useDraftSlideAnnotations.getState().annotations[conversationId] ?? [];
          const designs = useDraftDesignAnnotations.getState().annotations[conversationId] ?? [];
          const systems = useDraftDesignSystemAnnotations.getState().annotations[conversationId] ?? [];
          if (!slides.length && !designs.length && !systems.length) return true;
          const [failedSlides, failedDesigns, failedSystems] = await Promise.all([
            flushEditors(slides.map((n) => itemKey({ kind: 'slides', target: n.deck }))),
            flushEditors(designs.map((n) => itemKey({ kind: 'design', target: n.canvas }))),
            flushEditors(systems.map((n) => itemKey({ kind: 'design-system', target: n.system }))),
          ]);
          if (failedSlides.length) ToastQueue.negative(SLIDES.flushFailed(failedSlides), { timeout: 5000 });
          if (failedDesigns.length) ToastQueue.negative(DESIGN.flushFailed(failedDesigns), { timeout: 5000 });
          if (failedSystems.length) ToastQueue.negative(DESIGN_SYSTEM.flushFailed(failedSystems), { timeout: 5000 });
          return !failedSlides.length && !failedDesigns.length && !failedSystems.length;
        }}
        onSend={async (input, attachments, skills) => {
          // 幻灯片、设计稿与设计系统标注（§8.2、§10.6）：只带标注、没写话时补一句；发出去（或排进队列）后从草稿里摘掉。
          const drafted = useDraftSlideAnnotations.getState().annotations[conversationId] ?? [];
          const draftedDesigns = useDraftDesignAnnotations.getState().annotations[conversationId] ?? [];
          const draftedSystems = useDraftDesignSystemAnnotations.getState().annotations[conversationId] ?? [];
          const notes = sentSlideAnnotations(drafted);
          const designNotes = sentDesignAnnotations(draftedDesigns);
          const systemNotes = sentDesignSystemAnnotations(draftedSystems);
          const text =
            input ||
            [notes.length ? SLIDES.message : '', designNotes.length ? DESIGN.message : '', systemNotes.length ? DESIGN_SYSTEM.message : '']
              .filter(Boolean)
              .join('\n');
          const sentNotes = () => {
            useDraftSlideAnnotations.getState().sent(conversationId, drafted.map((n) => n.id));
            useDraftDesignAnnotations.getState().sent(conversationId, draftedDesigns.map((n) => n.id));
            useDraftDesignSystemAnnotations.getState().sent(conversationId, draftedSystems.map((n) => n.id));
          };
          // 前面还有排队的：排到最后，保持先后；会话空着就先发队首那一条。
          if (busy || useShell.getState().queues[conversationId]?.length) {
            await enqueue(text, attachments, skills, notes, designNotes, systemNotes);
            sentNotes();
            if (!busy)
              void drainQueue(runtime, conversationId).then((result) => {
                if (result.status === 'failed') reportQueueFailure(result.error);
              });
            return true;
          }
          try {
            await runtime.send(
              conversationId,
              text,
              await editor.capture(),
              attachments.map((a) => a.id),
              undefined,
              skills,
              notes,
              designNotes,
              systemNotes,
            );
            editor.reset();
            sentNotes();
            return true;
          } catch (error) {
            // 刚好有任务开跑（别的窗口、别的入口）：这句话排队，不丢。
            if (error instanceof RpcError && error.code === 'busy') {
              await enqueue(text, attachments, skills, notes, designNotes, systemNotes);
              sentNotes();
              return true;
            }
            ToastQueue.negative(sendFailureMessage(error), { timeout: 5000 });
            return false;
          }
        }}
        onStop={() => {
          if (!meta.activeTaskId) return;
          runtime.stop(meta.activeTaskId).catch((error: Error) => ToastQueue.negative(S.conversationView.stopFailed(error.message), { timeout: 5000 }));
        }}
      />
    </div>
  );
}
