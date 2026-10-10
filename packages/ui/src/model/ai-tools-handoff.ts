import type { Id } from '@baocut/protocol';

/** 视频的来源（`VideoRef.source`）：属于哪个项目，或在哪条无项目会话的工作目录里。 */
export interface HandoffSource {
  projectId: Id | null;
  conversationId: Id | null;
}

/** 挑会话要看的会话字段（目录里的 `Conversation`）。 */
export interface HandoffConversation {
  id: Id;
  projectId: Id | null;
  title: string;
  archived: boolean;
  updatedAt: string;
}

/**
 * 「会话」行的「接着这个视频当前的会话」指哪一条（原型 model-ai-prompt.js `sessionOptions`：这个项目里最近的那条）：
 *
 * 1. 当前就在一条会话里（Home 左侧的，或 Space 里这个视频的悬浮会话最近发起的那条），它和视频同属一个项目、或就是视频所在的
 *    那条无项目会话：就是它。
 * 2. 视频属于项目：这个项目里最近更新、没归档的那条。
 * 3. 视频不属于项目：它所在的那条会话（新建的会话看不到它的目录）。
 *
 * 都没有时 null。有没有说过话（消息数）由调用方另看：没说过话的不给「接着」（`sessionOptions`）。
 */
export function currentConversation<T extends HandoffConversation>({
  source,
  current,
  conversations,
}: {
  source: HandoffSource | null;
  current: Id | null;
  conversations: readonly T[];
}): T | null {
  if (!source) return null;
  const belongs = (c: T) => (source.projectId ? c.projectId === source.projectId : c.id === source.conversationId);
  const here = current ? conversations.find((c) => c.id === current) : undefined;
  if (here && belongs(here)) return here;
  if (!source.projectId) return conversations.find(belongs) ?? null;
  let latest: T | null = null;
  for (const c of conversations) if (!c.archived && belongs(c) && (!latest || c.updatedAt > latest.updatedAt)) latest = c;
  return latest;
}

/** 交给 Agent 发到哪：新建一条（在视频的项目里），或接着已有的那条。 */
export type HandoffPlan = { kind: 'existing'; conversationId: Id } | { kind: 'create'; projectId: Id } | { kind: 'none' };

/**
 * 按「会话」行的选择定下发到哪（产品设计 §5.10「交给智能体」）：新会话建在视频的项目里——视频不属于项目时新会话看不到它，
 * 交不出去（「会话」行这时不给新会话）；接着的那条要还在目录里。
 */
export function planHandoff({
  session,
  source,
  conversations,
}: {
  session: 'new' | { id: Id };
  source: HandoffSource | null;
  conversations: readonly { id: Id }[];
}): HandoffPlan {
  if (session === 'new') return source?.projectId ? { kind: 'create', projectId: source.projectId } : { kind: 'none' };
  return conversations.some((c) => c.id === session.id) ? { kind: 'existing', conversationId: session.id } : { kind: 'none' };
}

/** 一条会话里的消息数（「会话」行写「已有 n 条消息」）：用户说的与 Agent 回的都算，工具调用、思考与通知不算。 */
export function messageCount(items: readonly { kind: string }[]): number {
  let n = 0;
  for (const item of items) if (item.kind === 'user-message' || item.kind === 'agent-message') n++;
  return n;
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
