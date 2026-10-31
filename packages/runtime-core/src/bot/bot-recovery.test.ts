import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Id } from '@baocut/protocol';
import { BotKit } from './testing/bot-kit.ts';

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
