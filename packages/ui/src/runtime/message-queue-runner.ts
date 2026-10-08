/*
 * 忙时排队的发送：会话的任务结束后发出队首那一条；排队行的「立即发送」。
 *
 * 「Agent 从运行变成空闲时取一条发出、每个会话同时只发一条」的做法移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra）
 * packages/app/src/runtime/host-runtime.ts（`drainQueuedAgentMessage` 与它的 in-flight 集合），modified：
 * 改为订阅目录镜像里会话的 `activeTaskId` 由有变无；队列在 shell-store；发送失败放回队首、不重试。
 */
import type { Conversation, Id } from '@baocut/protocol';
import { sendQueueHead, sendQueuedNow, type QueueAccess, type QueuedMessage, type QueueSendResult, type QueueTransport } from '../model/message-queue.ts';
import { useDirectory } from '../state/directory-store.ts';
import { useShell } from '../state/shell-store.ts';
import type { RuntimeSession } from './session.ts';

function queueAccess(conversationId: Id): QueueAccess {
  return {
    read: () => useShell.getState().queues[conversationId] ?? [],
    write: (next) => useShell.getState().setQueue(conversationId, () => next),
  };
}

function transport(runtime: RuntimeSession, conversationId: Id): QueueTransport {
  const ids = (m: QueuedMessage) => m.attachments.map((a) => a.id);
  return {
    // 插话不带编辑器状态：协议的 steer 不收上下文。也不收 skill：带 skill 的不插话，回合还在跑就等它结束，已经结束就直接发。
    steer: (m) =>
      m.skill
        ? Promise.resolve(
            useDirectory.getState().conversations.find((c) => c.id === conversationId)?.activeTaskId ? 'unsupported' : 'no-active-turn',
          )
        : runtime.steer(conversationId, m.text, ids(m)),
    send: async (m) => {
      await runtime.send(conversationId, m.text, m.context, ids(m), undefined, m.skill);
    },
  };
}

/** 正在发的会话：任务结束的事件可能连着来，同一个会话同时只发一条。 */
const draining = new Set<Id>();

/** 发出这个会话队首的那一条（会话空闲时调用）。 */
export async function drainQueue(runtime: RuntimeSession, conversationId: Id): Promise<QueueSendResult> {
  if (draining.has(conversationId)) return { status: 'missing' };
  draining.add(conversationId);
  try {
    return await sendQueueHead(queueAccess(conversationId), transport(runtime, conversationId));
  } finally {
    draining.delete(conversationId);
  }
}

/** 排队行的「立即发送」：先试插话，不支持就留在队列，没有在跑的回合就直接发。 */
export function sendQueuedMessageNow(runtime: RuntimeSession, conversationId: Id, messageId: Id): Promise<QueueSendResult> {
  return sendQueuedNow(queueAccess(conversationId), transport(runtime, conversationId), messageId);
}

function activeTasks(conversations: readonly Conversation[]): Map<Id, Id | null> {
  return new Map(conversations.map((c) => [c.id, c.activeTaskId]));
}

/**
 * 盯着目录镜像：哪条会话的任务由有变无（完成、失败、停止），就发它队首的那一条。
 * 刚启动时看到的空闲会话不算「结束」：上次没发完的排队留着，等用户自己发，不在打开应用时突然替人发消息。
 */
export function startQueueRunner(runtime: RuntimeSession, onFailed: (message: string) => void): () => void {
  let previous = activeTasks(useDirectory.getState().conversations);
  return useDirectory.subscribe((state) => {
    const current = activeTasks(state.conversations);
    for (const [id, task] of previous) {
      if (task === null || !current.has(id) || current.get(id) !== null) continue;
      if (!useShell.getState().queues[id]?.length) continue;
      void drainQueue(runtime, id).then((result) => {
        if (result.status === 'failed') onFailed(result.error);
      });
    }
    previous = current;
  });
}
