import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Id } from '@baocut/protocol';
import { BotKit, escalate, type TurnContext } from './testing/bot-kit.ts';

/* 运行期的收尾与恢复：排队、重启对账、报告重投、等后台任务、删除频道等（评审意见的回归测试）。 */

let kit: BotKit;
beforeEach(async () => {
  kit = await BotKit.open();
});
afterEach(async () => {
  await kit.close();
});

/** 线程会话里这条任务的回合起止事件。 */
function threadRuns(id: Id) {
  const threadId = kit.item(id).threadId;
  return kit.runs.filter((r) => r.conversationId === threadId);
}

describe('queued launches', () => {
  it('a task started by the user while every slot is busy starts unattended when a slot frees later', async () => {
    await kit.bot.updateChannel(kit.main.id, { concurrentThreads: 1 });
    kit.thread = (ctx) => {
      if (kit.bot.itemOfThread(ctx.conversationId)?.title === 'Render the long cut') ctx.turn.hold();
    };
    const first = await kit.bot.createItem({ channelId: kit.main.id, title: 'Render the long cut', owner: 'agent' });
    await kit.bot.startItem(first.id, { attended: true });
    await kit.until(() => kit.item(first.id).active?.state === 'working' && kit.item(first.id).threadId);
    const second = await kit.bot.createItem({ channelId: kit.main.id, title: 'Render the short cut', owner: 'agent' });
    const started = await kit.bot.startItem(second.id, { attended: true, brief: 'Use the vertical crop.' });
    expect(started.queued).toBe(true);
    await kit.bot.stopItem(first.id);
    await kit.until(() => threadRuns(second.id).some((r) => r.type === 'started'));
    await kit.settle();
    const run = threadRuns(second.id).find((r) => r.type === 'started')!;
    expect(run.attended).toBe(false);
    expect(kit.turns(kit.threadOf(second.id))[0]).toContain('Use the vertical crop.');
  });
});

describe('restart while a thread waits on an approval', () => {
  async function waitingOnApproval(report: boolean) {
    let thread: TurnContext | null = null;
    kit.thread = (ctx) => {
      if (thread) return;
      thread = ctx;
      escalate(ctx, 'voice-generate --segment 1');
    };
    const item = await kit.bot.createItem({ channelId: kit.main.id, title: 'Voice the intro', owner: 'agent' });
    await kit.bot.startItem(item.id, { attended: true });
    await kit.until(() => kit.item(item.id).active?.state === 'needsInput' && kit.item(item.id).question?.approvalId);
    if (report) {
      await thread!.call('thread_report', { stop: 'needs-review', headline: 'The intro is voiced.' });
      expect(kit.item(item.id).deferredStop).toBe('needs-review');
    }
    return item;
  }

  it('the report sent during the approval lands after a restart instead of leaving the task on a dead approval', async () => {
    const item = await waitingOnApproval(true);
    kit.thread = () => {};
    await kit.restart();
    await kit.settle();
    expect(kit.item(item.id)).toMatchObject({ status: 'active', active: { state: 'needsReview' }, deferredStop: null });
    expect(kit.item(item.id).question?.approvalId ?? null).toBeNull();
  });

  it('without a report the task is shown as interrupted, with Continue', async () => {
    const item = await waitingOnApproval(false);
    kit.thread = () => {};
    await kit.restart();
    await kit.settle();
    expect(kit.item(item.id)).toMatchObject({ status: 'active', active: { state: 'blocked' }, question: { askedBy: 'system', approvalId: null } });
  });
});

describe('restart with a working task that never got its thread', () => {
  it('is shown as interrupted instead of holding a slot', async () => {
    const item = await kit.bot.createItem({ channelId: kit.main.id, title: 'Trim the intro', owner: 'agent' });
    // 开线程之前崩溃：任务已是工作中，线程还没建。
    await kit.bot.patchItemContent(item.id, (i) => ({ ...i, status: 'active', active: { state: 'working', reason: null, since: new Date().toISOString() } }), true);
    await kit.restart();
    await kit.settle();
    expect(kit.item(item.id)).toMatchObject({ threadId: null, active: { state: 'blocked' }, question: { askedBy: 'system' } });
    expect(kit.bot.status().workingThreads).toEqual([]);
  });
});
