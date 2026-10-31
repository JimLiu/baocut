import { isMoneyAmount, microsToMoney, moneyToMicros, type Channel, type Money, type TaskBudgetLimits, type WorkItem } from '@baocut/protocol';

/*
 * 线程任务的预算上限（Bot 技术方案 §14.5）：取任务自己的预算与频道今天、本月剩下的额度里最小的一个。频道花了多少由 Runtime 从
 * 用量账本按会话汇总（`BotWorkspace.channelSpend`）。币种不同的额度没法比较，只看和第一个额度同币种的。
 */

/** 一个频道在今天与本月已经花掉的钱（按币种分列）。 */
export interface ChannelSpend {
  day: Money[];
  month: Money[];
}

/** 本地时间的今天零点与本月一号零点。 */
export function spendWindow(now: number): { day: string; month: string } {
  const d = new Date(now);
  return {
    day: new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString(),
    month: new Date(d.getFullYear(), d.getMonth(), 1).toISOString(),
  };
}

function remaining(limit: Money, spent: Money[]): Money {
  const used = spent.filter((m) => m.currency === limit.currency).reduce((sum, m) => sum + moneyToMicros(m.amount), 0n);
  const left = moneyToMicros(limit.amount) - used;
  return { amount: microsToMoney(left > 0n ? left : 0n), currency: limit.currency };
}

/** 没有任何额度时 null（不设上限）。 */
export function threadTaskBudget(item: WorkItem, channel: Channel, spend: ChannelSpend | undefined): TaskBudgetLimits | null {
  const caps: Money[] = [];
  if (item.overrides?.budget) caps.push(item.overrides.budget);
  if (channel.limits.dailyBudget) caps.push(remaining(channel.limits.dailyBudget, spend?.day ?? []));
  if (channel.limits.monthlyBudget) caps.push(remaining(channel.limits.monthlyBudget, spend?.month ?? []));
  if (caps.length === 0) return null;
  const currency = caps[0]!.currency;
  const cap = caps.filter((m) => m.currency === currency).reduce((a, b) => (moneyToMicros(b.amount) < moneyToMicros(a.amount) ? b : a));
  return { maxCalls: null, cap };
}

/** 账本记录的金额按币种加起来（只算供应商报告了金额的调用）。 */
export function sumMoney(amounts: readonly Money[]): Money[] {
  const totals = new Map<string, bigint>();
  for (const m of amounts) if (isMoneyAmount(m.amount)) totals.set(m.currency, (totals.get(m.currency) ?? 0n) + moneyToMicros(m.amount));
  return [...totals].map(([currency, micros]) => ({ currency, amount: microsToMoney(micros) }));
}
