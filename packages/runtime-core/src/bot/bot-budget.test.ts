import { afterEach, describe, expect, it } from 'vitest';
import type { Channel, Id, WorkItem } from '@baocut/protocol';
import { channelBudgetSpent, spendWindow, sumMoney, threadTaskBudget } from './bot-budget.ts';
import { textMakeGenerator } from './make-generator.ts';
import type { TextGenerator } from '@baocut/models';
import { BotKit } from './testing/bot-kit.ts';

/* 线程任务的预算上限（技术方案 §14.5）：任务预算与频道今天、本月剩余额度的较小值。 */

const usd = (amount: string) => ({ amount, currency: 'USD' });
const channel = (daily: string | null, monthly: string | null) =>
  ({ limits: { concurrentThreads: 3, dailyBudget: daily ? usd(daily) : null, monthlyBudget: monthly ? usd(monthly) : null } }) as Channel;
const item = (budget: string | null) => ({ overrides: budget ? { accessMode: null, driverId: null, model: null, budget: usd(budget), outputLanguage: null } : null }) as WorkItem;

describe('Make and the channel budget (BOT-NF-04)', () => {
  it('the allowance counts as spent only when a set daily or monthly limit has nothing left', () => {
    expect(channelBudgetSpent(channel(null, null), { day: [usd('99')], month: [usd('99')] })).toBe(false);
    expect(channelBudgetSpent(channel('5', null), { day: [usd('4.99')], month: [] })).toBe(false);
    expect(channelBudgetSpent(channel('5', null), { day: [usd('5')], month: [] })).toBe(true);
    expect(channelBudgetSpent(channel(null, '20'), { day: [], month: [usd('21')] })).toBe(true);
  });

  it('the text call of a Make run is recorded against the channel conversation', async () => {
    const options: unknown[] = [];
    const text = { generate: async (_request: unknown, opts: unknown) => (options.push(opts), { text: '{"suggestions":[]}', json: { suggestions: [] } }), stats: () => ({}) } as unknown as TextGenerator;
    await textMakeGenerator(() => text).suggest({ conversationId: 'conv_main', channelName: 'Main', purpose: '', memory: '', openTasks: [], recentlyResolved: [], userMessages: [], facts: [], language: null });
    expect(options).toEqual([{ ref: { conversationId: 'conv_main' } }]);
  });
});

describe('threadTaskBudget', () => {
  it('no budget anywhere means no cap', () => {
    expect(threadTaskBudget(item(null), channel(null, null), undefined)).toBeNull();
  });

  it('takes the smallest of the task budget and what is left of the day and the month', () => {
    const spend = { day: [usd('3.5')], month: [usd('18')] };
    expect(threadTaskBudget(item(null), channel('5', null), spend)).toEqual({ maxCalls: null, cap: usd('1.50') });
    expect(threadTaskBudget(item('1'), channel('5', null), spend)).toEqual({ maxCalls: null, cap: usd('1') });
    expect(threadTaskBudget(item('10'), channel('5', '20'), spend)).toEqual({ maxCalls: null, cap: usd('1.50') });
    expect(threadTaskBudget(item('10'), channel(null, '20'), spend)).toEqual({ maxCalls: null, cap: usd('2.00') });
  });

  it('a spent allowance caps at zero, so the next paid call stops and asks', () => {
    expect(threadTaskBudget(item(null), channel('5', null), { day: [usd('7')], month: [] })).toEqual({ maxCalls: null, cap: usd('0.00') });
  });

  it('spend in another currency does not count against the allowance', () => {
    expect(threadTaskBudget(item(null), channel('5', null), { day: [{ amount: '4', currency: 'CNY' }], month: [] })).toEqual({ maxCalls: null, cap: usd('5.00') });
  });

  it('sums amounts per currency and skips amounts it cannot read', () => {
    expect(sumMoney([usd('1.25'), usd('0.75'), { amount: '2', currency: 'CNY' }, usd('n/a')])).toEqual([usd('2.00'), { amount: '2.00', currency: 'CNY' }]);
  });

  it('the day starts at local midnight and the month on the first', () => {
    const at = new Date(2026, 9, 31, 15, 20).getTime();
    expect(spendWindow(at)).toEqual({ day: new Date(2026, 9, 31).toISOString(), month: new Date(2026, 9, 1).toISOString() });
  });
});

describe('budgets on thread tasks', () => {
  let kit: BotKit;
  afterEach(async () => {
    await kit?.close();
  });

  const startedTasks = (conversationId: Id) =>
    kit.runs.filter((r): r is Extract<typeof r, { type: 'started' }> => r.type === 'started' && r.conversationId === conversationId).map((r) => r.taskId);

  it('a thread task gets the channel allowance that is left; a task budget set later caps the next turn', async () => {
    kit = await BotKit.open();
    await kit.bot.updateChannel(kit.main.id, { dailyBudget: usd('5.00') });
    kit.workspace.spend = { day: [usd('3.5')], month: [usd('3.5')] };
    const created = await kit.startTask('Cut the trailer');
    const threadId = kit.threadOf(created.id);
    const first = startedTasks(threadId)[0]!;
    expect(kit.budgets.limits.get(first)).toEqual({ maxCalls: null, cap: usd('1.50') });
    expect(kit.workspace.spendAsks.at(-1)).toEqual(expect.arrayContaining([kit.main.conversationId, threadId]));
    // 协调者自己的回合不受频道预算限制。
    for (const taskId of startedTasks(kit.main.conversationId)) expect(kit.budgets.limits.get(taskId)?.cap ?? null).toBeNull();

    await kit.bot.updateItem(created.id, { overrides: { accessMode: null, driverId: null, model: null, budget: usd('1.00'), outputLanguage: null } });
    await kit.send(threadId, 'Also make a square version.');
    await kit.settle();
    const second = startedTasks(threadId).at(-1)!;
    expect(second).not.toBe(first);
    expect(kit.budgets.limits.get(second)).toEqual({ maxCalls: null, cap: usd('1.00') });
  });

  it('without channel budgets thread tasks are not capped', async () => {
    kit = await BotKit.open();
    kit.workspace.spend = { day: [usd('3.5')], month: [usd('3.5')] };
    const created = await kit.startTask('Make chapters');
    const task = startedTasks(kit.threadOf(created.id))[0]!;
    expect(kit.budgets.limits.get(task)).toEqual({ maxCalls: null, cap: null });
  });

  it('BOT-NF-04 a channel without a budget still shows what it spent, and each task shows its own total', async () => {
    kit = await BotKit.open();
    const created = await kit.startTask('Make chapters');
    const threadId = kit.threadOf(created.id);
    kit.workspace.spend = { day: [usd('0.40')], month: [usd('2.10')], byConversation: { [threadId]: [usd('1.25')], [kit.main.conversationId]: [usd('0.85')] } };
    await kit.send(threadId, 'Add one more chapter.');
    await kit.settle();
    const row = kit.bot.listChannels().find((c) => c.channel.id === kit.main.id)!;
    expect(row.spend).toEqual({ today: usd('0.40'), month: usd('2.10'), tasks: { [created.id]: usd('1.25') } });
  });
});
