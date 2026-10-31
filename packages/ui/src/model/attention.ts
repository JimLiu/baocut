import type { Conversation, ConversationActivity, Id } from '@baocut/protocol';

/*
 * 要用户回来看一眼的时刻（产品设计 §3.1「提醒」）：会话等你批准、等你回答、任务做完或失败。界面比较目录镜像前后两份，
 * 只认状态的跳变；快照（首次连上与重连）只作为新的基线，不补发错过的。要不要打扰按用户在不在、看着哪条会话决定。
 */

export type AttentionKind = 'approval' | 'question' | 'finished' | 'failed';

export interface AttentionEvent {
  conversationId: Id;
  title: string;
  kind: AttentionKind;
}

/** 多久没有键盘鼠标就算人不在跟前（与 paseo 的取值相同）。 */
export const PRESENCE_MS = 180_000;

/** 状态从 `prev` 跳到 `next` 时要不要提醒、提醒哪一种。停止后回到空闲（`stopping` → `idle`）是用户自己停的，不提醒。 */
export function attentionKind(prev: ConversationActivity, next: ConversationActivity): AttentionKind | null {
  if (prev === next) return null;
  switch (next) {
    case 'awaiting-approval':
      return 'approval';
    case 'awaiting-answer':
      return 'question';
    case 'failed':
      return 'failed';
    case 'idle':
      return prev === 'running' || prev === 'awaiting-approval' || prev === 'awaiting-answer' ? 'finished' : null;
    default:
      return null;
  }
}

/** 两份目录镜像之间的提醒。新出现的会话（之前没有）与已归档的不算。 */
export function attentionEvents(prev: readonly Conversation[], next: readonly Conversation[]): AttentionEvent[] {
  const before = new Map(prev.map((c) => [c.id, c.activity]));
  const events: AttentionEvent[] = [];
  for (const conversation of next) {
    const was = before.get(conversation.id);
    // Bot 的频道对话与线程有自己的通知（`bot.notification`），这里不重复提醒。
    if (was === undefined || conversation.archived || isBotRole(conversation)) continue;
    const kind = attentionKind(was, conversation.activity);
    if (kind) events.push({ conversationId: conversation.id, title: conversation.title, kind });
  }
  return events;
}

/** Dock / 任务栏徽标上的数：在等用户批准或回答的会话条数。 */
export function waitingCount(conversations: readonly Conversation[]): number {
  return conversations.filter((c) => !c.archived && !isBotRole(c) && (c.activity === 'awaiting-approval' || c.activity === 'awaiting-answer')).length;
}

function isBotRole(c: Conversation): boolean {
  return c.role === 'channel' || c.role === 'thread';
}

export interface Presence {
  /** 窗口在前台、有焦点。 */
  focused: boolean;
  /** 正看着的会话（Home 的会话区；Space 的悬浮会话不显示会话内容，不算）；没有时 null。 */
  viewing: Id | null;
  /** 最近一次键盘、鼠标或触摸的时刻（毫秒）；还没有时 null。 */
  lastInputAt: number | null;
}

/**
 * 怎么提醒：`none` 不打扰（窗口在前台、人在跟前、正看着这条会话）；`toast` 人在跟前、看着别处，在应用里弹一句；
 * `system` 人不在跟前或窗口在后台，发系统通知。
 */
export function attentionChannel(presence: Presence, conversationId: Id, now: number): 'none' | 'toast' | 'system' {
  const present = presence.focused && presence.lastInputAt !== null && now - Math.min(presence.lastInputAt, now) <= PRESENCE_MS;
  if (!present) return 'system';
  return presence.viewing === conversationId ? 'none' : 'toast';
}
