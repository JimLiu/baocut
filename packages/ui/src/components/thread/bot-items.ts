import { createContext, useContext, type ReactNode } from 'react';
import type { Id, TimelineItem } from '@baocut/protocol';
import type { BotTimelineItem } from '../../model/thread.ts';

/**
 * 线程里 Bot 条目（线程卡、报告与转交、提议卡）的渲染器（docs/design/bot-mode 技术方案 §17.2）。Bot 页在频道对话与任务线程外面提供；
 * 普通会话里没有提供者，这些条目不占一行——Home 打不开 Bot 的会话，这只是兜底，不让旧版本或别的入口崩掉。
 */
export type BotItemRenderer = (item: BotTimelineItem, conversationId: string) => ReactNode;

export const BotItemsContext = createContext<BotItemRenderer | null>(null);

export function useBotItemRenderer(): BotItemRenderer | null {
  return useContext(BotItemsContext);
}

type MessageItem<K extends 'user-message' | 'agent-message'> = Extract<TimelineItem, { kind: K }>;

/**
 * 频道对话与任务线程里普通消息上的 Bot 附加（需求 §11.4）：用户消息可以改（BOT-EX-06）、标出回复的是哪张线程卡（BOT-EX-09），
 * 智能体消息可以点表情（BOT-EX-10）；「你不在时」的「以下是新消息」细线画在 `unread.itemId` 那一行前面。普通会话没有提供者。
 */
export interface BotThreadExtras {
  unread: { itemId: Id; node: ReactNode } | null;
  userMessage: ((item: MessageItem<'user-message'>, conversationId: Id) => ReactNode) | null;
  agentMessage: ((item: MessageItem<'agent-message'>, conversationId: Id) => ReactNode) | null;
  /** 频道里「回复」一张线程卡（BOT-EX-09）：下一条消息带上 `replyToItemId`。没有时卡片上不给「回复」。 */
  reply?: ((cardItemId: Id, workItemId: Id) => void) | null;
}

export const BotThreadExtrasContext = createContext<BotThreadExtras | null>(null);

export function useBotThreadExtras(): BotThreadExtras | null {
  return useContext(BotThreadExtrasContext);
}
