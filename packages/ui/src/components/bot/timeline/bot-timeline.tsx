import { useCallback, type ReactNode } from 'react';
import type { Id } from '@baocut/protocol';
import { BotItemsContext, BotThreadExtrasContext, type BotThreadExtras } from '../../thread/bot-items.ts';
import type { BotTimelineItem } from '../../../model/thread.ts';
import { ProposalCard } from './proposal-card.tsx';
import { RelayRow } from './relay-row.tsx';
import { WorkItemRefCard } from './work-item-ref-card.tsx';

/**
 * 给频道对话与任务线程的时间线提供 Bot 条目的渲染（技术方案 §17.2）：线程卡、报告与转交行、提议卡。
 * 每条外面包一层 `data-bot-item`，「跳到第一条未读」按它找位置。
 */
export function BotTimeline({ channelId, extras = null, children }: { channelId: Id | null; extras?: BotThreadExtras | null; children: ReactNode }) {
  const render = useCallback(
    (item: BotTimelineItem, conversationId: Id) => (
      <div data-bot-item={item.id}>
        {item.kind === 'work-item-ref' ? (
          <WorkItemRefCard workItemId={item.workItemId} channelId={channelId} />
        ) : item.kind === 'relay' ? (
          <RelayRow item={item} channelId={channelId} />
        ) : (
          <ProposalCard item={item} conversationId={conversationId} channelId={channelId} />
        )}
      </div>
    ),
    [channelId],
  );
  return (
    <BotItemsContext.Provider value={render}>
      <BotThreadExtrasContext.Provider value={extras}>{children}</BotThreadExtrasContext.Provider>
    </BotItemsContext.Provider>
  );
}
