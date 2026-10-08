import {
  RpcError,
  nowIso,
  type Conversation,
  type Id,
  type SpaceContinueResult,
  type SpaceEntry,
  type SpaceEntryReference,
} from '@baocut/protocol';
import type { Harness } from '@baocut/harness';
import type { SpaceCatalog } from '../space-catalog.ts';
import { projectOf, visibleTo } from './space-queries.ts';
import { RcSpace } from '@baocut/protocol/messages/runtime-core';

/**
 * 从 Space 条目继续一段会话（`space.continueInConversation`，架构设计 §5.7）。只建（或找到）会话、附上条目的引用，不启动任务：
 * 引用随用户下一次发送附在消息后面。
 *
 * 放进哪个会话：
 * - 给了 `conversationId`：用它。它要看得到这个条目（与智能体工具 `space_list` 同一条规则，`visibleTo` 的 `source` 视角），
 *   否则以 `SPACE_CONVERSATION_MISMATCH` 拒绝：引用放进去了，智能体也取不到内容。
 * - 属于项目的条目：在那个项目里新建会话。项目里的会话各有各的话题，不猜该接哪一个。
 * - 不属于项目的条目：回到它所在（或产生它）的会话，那个会话不在了时新建一个不属于项目的会话。
 *
 * 带的上下文只有条目的标识与元数据（`SpaceEntryReference`），不读文件内容。回收站里的条目拒绝（`SPACE_ENTRY_TRASHED`）。
 * `commandId` 重试时回答同一个会话，不重复新建。
 */
export async function continueInConversation(
  space: SpaceCatalog,
  harness: Harness,
  params: { entryId: Id; conversationId?: Id; commandId?: Id },
): Promise<SpaceContinueResult> {
  const entry = space.get(params.entryId);
  if (entry.user.trashedAt !== null) {
    throw new RpcError('conflict', RcSpace.continueFromTrash(), { code: 'SPACE_ENTRY_TRASHED' });
  }
  const reference = referenceOf(entry);
  const projectId = projectOf(entry);

  let conversation: Conversation | null = null;
  let created = false;
  if (params.conversationId) {
    conversation = harness.getConversation(params.conversationId).conversation;
    if (!visibleTo({ kind: 'source', projectId: conversation.projectId, conversationId: conversation.id }, entry)) {
      throw new RpcError('conflict', RcSpace.conversationCantSee(), {
        code: 'SPACE_CONVERSATION_MISMATCH',
      });
    }
  } else if (!projectId) {
    const origin = entry.source.conversationId ?? entry.origin?.conversationId ?? null;
    conversation = origin ? findConversation(harness, origin) : null;
  }
  if (!conversation) {
    // 同一个 `commandId` 重试时拿到的是上次建的会话：按调用之前有没有这个会话判断，不比较时间戳（同一毫秒里分不出先后）。
    const existing = new Set(harness.directorySnapshot().conversations.map((c) => c.id));
    conversation = await harness.createConversation({
      projectId,
      ...(params.commandId ? { commandId: `space-continue:${params.commandId}` } : {}),
    });
    // 引用按条目去重，再挂一次无害。
    created = !existing.has(conversation.id);
  }
  conversation = harness.attachReference(conversation.id, reference);
  return { conversation, created, reference };
}

function findConversation(harness: Harness, conversationId: Id): Conversation | null {
  try {
    return harness.getConversation(conversationId).conversation;
  } catch {
    return null;
  }
}

/** 条目的引用：标识与元数据，不含文件内容与生成参数。 */
export function referenceOf(entry: SpaceEntry): SpaceEntryReference {
  const inSource = entry.source.projectId !== null || entry.source.conversationId !== null;
  return {
    entryId: entry.id,
    kind: entry.kind,
    name: entry.name,
    projectId: projectOf(entry),
    relPath: inSource ? entry.relPath : null,
    videoId: entry.ref && 'videoId' in entry.ref ? entry.ref.videoId : (entry.origin?.videoId ?? null),
    artifactId: entry.ref && 'artifactId' in entry.ref ? entry.ref.artifactId : null,
    status: entry.status,
    origin: entry.origin
      ? {
          source: entry.origin.source,
          ...(entry.origin.capability ? { capability: entry.origin.capability } : {}),
          ...(entry.origin.jobId ? { jobId: entry.origin.jobId } : {}),
          ...(entry.origin.conversationId ? { conversationId: entry.origin.conversationId } : {}),
          ...(entry.origin.videoRevision ? { videoRevision: entry.origin.videoRevision } : {}),
        }
      : null,
    attachedAt: nowIso(),
  };
}
