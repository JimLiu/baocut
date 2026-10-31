import type { Id } from '@baocut/protocol';
import { formatMoneyOne } from '../../model/usage-format.ts';
import { useChannels } from '../../state/channels-store.ts';
import { BOT_COPY as C } from './bot-copy.ts';

/**
 * 一项任务从开始到现在累计的花费（BOT-NF-04），取自频道摘要里的 `spend.tasks`：任务卡与任务详情里写一行。
 * 没有账本、或这项任务没花过钱时为 null。
 */
export function useTaskSpend(channelId: Id | null, workItemId: Id): string | null {
  const total = useChannels((s) => s.channels.find((c) => c.channel.id === channelId)?.spend?.tasks?.[workItemId] ?? null);
  return total && Number(total.amount) > 0 ? C.channel.taskSpend(formatMoneyOne(total)) : null;
}
