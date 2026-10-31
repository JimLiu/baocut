import { createContext, useContext, type ReactNode } from 'react';
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
