import type { Id } from '@baocut/protocol';

/**
 * 工具页「交给 Agent」发到哪条会话（原型 panel-aitools-flows.jsx `sendToAgent`：直接发到这个视频的会话里）。
 *
 * 1. 当前就在一条会话里、它和视频同属一个项目（或它就是视频所在的那条无项目会话）：就用它。
 * 2. 视频属于项目：在这个项目里新建一条会话。
 * 3. 视频不属于项目、在某条会话的工作目录里：用那条会话（新建的会话看不到它的目录）。
 * 4. 都不是：交不出去，说明原因。
 */
export type HandoffPlan = { kind: 'existing'; conversationId: Id } | { kind: 'create'; projectId: Id } | { kind: 'none' };

export interface HandoffInput {
  /** 视频的来源（`VideoRef.source`）；视频还没打开时 null。 */
  source: { projectId: Id | null; conversationId: Id | null } | null;
  /** 当前所在的会话（Home 的 `conversationId`，或 Space 里这个视频的悬浮会话）；没有时 null。 */
  current: Id | null;
  conversations: readonly { id: Id; projectId: Id | null }[];
}

export function pickHandoff({ source, current, conversations }: HandoffInput): HandoffPlan {
  if (!source) return { kind: 'none' };
  const here = current ? conversations.find((c) => c.id === current) : undefined;
  if (here && (source.projectId ? here.projectId === source.projectId : here.id === source.conversationId)) {
    return { kind: 'existing', conversationId: here.id };
  }
  if (source.projectId) return { kind: 'create', projectId: source.projectId };
  if (source.conversationId && conversations.some((c) => c.id === source.conversationId)) {
    return { kind: 'existing', conversationId: source.conversationId };
  }
  return { kind: 'none' };
}

/**
 * 没发出去时把那句话放回输入框（比如 Agent 没连上、发送失败）：输入框里本来有字就接在后面（空一行），不覆盖用户写了一半的话；同一句已经在里面就不重复放。
 */
export function mergeDraft(existing: string | undefined, text: string): string {
  const before = existing ?? '';
  const next = text.trim();
  if (!next) return before;
  if (!before.trim()) return next;
  if (before.includes(next)) return before;
  return `${before.trimEnd()}\n\n${next}`;
}
