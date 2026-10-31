import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, type Id, type ThreadReport } from '@baocut/protocol';
import { WorkItemStore } from '@baocut/runtime-storage';
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

describe('restart when the channel data did not load cleanly', () => {
  it('a thread is not archived as an orphan when its channel task log is unreadable', async () => {
    const item = await kit.startTask('Cut the trailer');
    const threadId = kit.threadOf(item.id);
    await kit.restart({ whileDown: () => fs.writeFile(path.join(kit.home.workItemsDir, `${kit.main.id}.jsonl`), 'not a log\n') });
    await kit.settle();
    expect(kit.harness.conversationOf(threadId)?.archived).toBe(false);
  });

  it('a thread is not archived when the channel list was written by a newer version', async () => {
    const channel = await kit.bot.createChannel({ name: 'Shorts' });
    const item = await kit.bot.createItem({ channelId: channel.id, title: 'Cut a short', owner: 'agent' });
    await kit.bot.startItem(item.id, { attended: false });
    await kit.until(() => kit.item(item.id).threadId);
    await kit.settle();
    const threadId = kit.threadOf(item.id);
    await kit.restart({
      whileDown: async () => {
        const file = kit.home.channelsFile;
        const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
        await fs.writeFile(file, JSON.stringify({ ...raw, schemaVersion: 99 }));
      },
    });
    await kit.settle();
    expect(kit.harness.conversationOf(threadId)?.archived).toBe(false);
  });

  it('a thread whose task is really gone is still archived when everything loaded', async () => {
    const item = await kit.startTask('Cut the teaser');
    const threadId = kit.threadOf(item.id);
    await kit.restart({
      whileDown: async () => {
        // 任务从日志里删掉（之前的版本删了任务却留下了线程）。
        const file = path.join(kit.home.workItemsDir, `${kit.main.id}.jsonl`);
        await fs.appendFile(file, `${JSON.stringify({ op: 'removed', workItemId: item.id })}\n`);
      },
    });
    await kit.settle();
    expect(kit.harness.conversationOf(threadId)?.archived).toBe(true);
  });
});

describe('a report is saved before the task moves', () => {
  it('when saving the report fails the task stays working, so the thread can report again', async () => {
    const outcomes: boolean[] = [];
    let turn = 0;
    kit.thread = async (ctx) => {
      if (turn++ > 0) return;
      const failing = vi.spyOn(WorkItemStore.prototype, 'appendReport').mockRejectedValueOnce(new Error('disk full'));
      outcomes.push((await ctx.tryCall('thread_report', { stop: 'needs-review', headline: 'The trailer is cut.' })).ok);
      failing.mockRestore();
      outcomes.push((await ctx.tryCall('thread_report', { stop: 'needs-review', headline: 'The trailer is cut.' })).ok);
    };
    const item = await kit.startTask('Cut the trailer');
    await kit.until(() => outcomes.length === 2);
    await kit.settle();
    expect(outcomes).toEqual([false, true]);
    expect(kit.item(item.id).active?.state).toBe('needsReview');
    await kit.restart();
    const reloaded = kit.bot.getItem(item.id);
    expect(reloaded.reports.map((r) => r.id)).toContain(reloaded.item.lastReportId);
  });

  it('a report saved just before a crash is applied after the restart', async () => {
    kit.thread = (ctx) => ctx.turn.hold();
    const item = await kit.bot.createItem({ channelId: kit.main.id, title: 'Cut the teaser', owner: 'agent' });
    await kit.bot.startItem(item.id, { attended: false });
    await kit.until(() => kit.item(item.id).active?.state === 'working' && kit.item(item.id).threadId);
    const report: ThreadReport = {
      id: newId('rep'),
      workItemId: item.id,
      threadId: kit.threadOf(item.id),
      taskId: newId('task'),
      stop: 'needs-review',
      headline: 'The teaser is cut.',
      text: '',
      question: null,
      outputs: [],
      userTodos: [],
      followUps: [],
      waitingFor: null,
      appliedRules: [],
      fallback: false,
      createdAt: new Date().toISOString(),
      delivery: 'pending',
    };
    kit.thread = () => {};
    await kit.restart({
      whileDown: () => fs.appendFile(path.join(kit.home.workItemsDir, `${kit.main.id}.jsonl`), `${JSON.stringify({ op: 'report', report })}\n`),
    });
    await kit.settle();
    expect(kit.item(item.id)).toMatchObject({ lastReportId: report.id, active: { state: 'needsReview' } });
    expect(kit.turns(kit.main.conversationId).at(-1)).toContain('headline: The teaser is cut.');
  });
});

describe('a thread waiting on background jobs', () => {
  function lastHeadline(id: Id) {
    const item = kit.item(id);
    return kit.bot.getItem(id).reports.find((r) => r.id === item.lastReportId)?.headline;
  }

  /** 线程第一回合报告在等 Job，之后的回合报告待审阅。 */
  function waitsThenFinishes(jobId: string) {
    const turns = new Map<Id, number>();
    return async (ctx: TurnContext) => {
      const n = (turns.get(ctx.conversationId) ?? 0) + 1;
      turns.set(ctx.conversationId, n);
      if (n === 1) await ctx.call('thread_report', { stop: 'waiting', headline: 'The dub is rendering.', waitingFor: { jobIds: [jobId] } });
      else await ctx.call('thread_report', { stop: 'needs-review', headline: 'The dub is ready.' });
    };
  }

  it('C2: a job wake held back for a free slot is not lost across a restart', async () => {
    await kit.bot.updateChannel(kit.main.id, { concurrentThreads: 1 });
    const waiting = waitsThenFinishes('job_a');
    kit.thread = (ctx) => (kit.bot.itemOfThread(ctx.conversationId)?.title === 'Render the long cut' ? ctx.turn.hold() : waiting(ctx));
    const dub = await kit.startTask('Dub episode 3');
    expect(kit.item(dub.id).active?.state).toBe('waitingOnOthers');
    const busy = await kit.bot.createItem({ channelId: kit.main.id, title: 'Render the long cut', owner: 'agent' });
    await kit.bot.startItem(busy.id, { attended: false });
    await kit.until(() => kit.item(busy.id).active?.state === 'working' && kit.item(busy.id).threadId);
    const thread = kit.threadOf(dub.id);
    const taskId = kit.items(thread).filter((i) => i.kind === 'task').at(-1)!.id;
    await kit.harness.jobFinished({ conversationId: thread, taskId, jobId: 'job_a', kind: 'dub', attempt: 1, state: 'completed' });
    expect(kit.harness.gatedJobWakes()).toContain(thread);
    kit.workspace.finishedJobs.add('job_a');
    await kit.restart();
    await kit.until(() => kit.item(dub.id).active?.state === 'needsReview');
    await kit.settle();
    expect(lastHeadline(dub.id)).toBe('The dub is ready.');
  });

  it('the watchdog wakes a thread whose jobs finished when the wake never came', async () => {
    kit.thread = waitsThenFinishes('job_b');
    const dub = await kit.startTask('Dub episode 4');
    expect(kit.item(dub.id).active?.state).toBe('waitingOnOthers');
    await kit.bot.watchdog();
    await kit.settle();
    expect(kit.item(dub.id).active?.state).toBe('waitingOnOthers');
    kit.workspace.finishedJobs.add('job_b');
    await kit.bot.watchdog();
    await kit.until(() => kit.item(dub.id).active?.state === 'needsReview');
    await kit.settle();
    expect(lastHeadline(dub.id)).toBe('The dub is ready.');
  });

  it('a job that finishes after the thread already asked for review brings the task back to working, so its new report lands', async () => {
    let turn = 0;
    kit.thread = async (ctx) => {
      turn++;
      if (turn === 1) await ctx.call('thread_report', { stop: 'needs-review', headline: 'The rough cut is ready; the export is still running.' });
      else await ctx.call('thread_report', { stop: 'needs-review', headline: 'The export is ready too.' });
    };
    const item = await kit.startTask('Cut and export episode 5');
    expect(kit.item(item.id).active?.state).toBe('needsReview');
    const thread = kit.threadOf(item.id);
    const taskId = kit.items(thread).filter((i) => i.kind === 'task').at(-1)!.id;
    expect(await kit.harness.jobFinished({ conversationId: thread, taskId, jobId: 'job_c', kind: 'export', attempt: 1, state: 'completed' })).toBe('woke');
    await kit.until(() => turn === 2);
    await kit.settle();
    expect(lastHeadline(item.id)).toBe('The export is ready too.');
    expect(kit.bot.getItem(item.id).transitions.map((t) => t.cause)).toContain('unblocked:job-finished');
  });

  it('a job wake does not resume a task the user stopped', async () => {
    let turn = 0;
    kit.thread = async () => {
      turn++;
    };
    const item = await kit.startTask('Cut episode 6');
    await kit.bot.stopItem(item.id).catch(() => {});
    await kit.settle();
    expect(kit.item(item.id).active?.state).toBe('blocked');
    const thread = kit.threadOf(item.id);
    const taskId = kit.items(thread).filter((i) => i.kind === 'task').at(-1)!.id;
    await kit.harness.jobFinished({ conversationId: thread, taskId, jobId: 'job_d', kind: 'export', attempt: 1, state: 'completed' });
    await kit.settle();
    expect(kit.item(item.id).active?.state).toBe('blocked');
  });
});

describe('a report that could not be relayed is sent again', () => {
  const reportItems = () => kit.items(kit.main.conversationId).filter((i) => i.kind === 'relay' && i.direction === 'report');

  it('S4: a report held behind a coordinator turn the user stopped is relayed after the next coordinator turn ends', async () => {
    await kit.close();
    kit = await BotKit.open({ steer: false });
    let coordinatorTurns = 0;
    let first: TurnContext['turn'] | null = null;
    kit.coordinator = (ctx) => {
      coordinatorTurns++;
      if (coordinatorTurns === 1) {
        first = ctx.turn;
        ctx.turn.hold();
      }
    };
    kit.thread = (ctx) => ctx.call('thread_report', { stop: 'needs-review', headline: 'The cut is ready.' });
    await kit.send(kit.main.conversationId, 'How is it going?');
    await kit.until(() => first);
    const item = await kit.bot.createItem({ channelId: kit.main.id, title: 'Cut the trailer', owner: 'agent' });
    await kit.bot.startItem(item.id, { attended: false });
    await kit.until(() => kit.item(item.id).active?.state === 'needsReview');
    await kit.until(() => kit.items(kit.main.conversationId).some((i) => i.kind === 'relay' && i.direction === 'report'));
    const report = kit.bot.getItem(item.id).reports.at(-1)!;
    // 报告排在协调者回合后面；用户停了这一回合，等着的投递跟着丢掉。
    await kit.harness.stopTask(kit.harness.conversationOf(kit.main.conversationId)!.activeTaskId!);
    await kit.until(() => kit.harness.conversationOf(kit.main.conversationId)?.activity === 'idle');
    await kit.settle();
    expect(kit.bot.getItem(item.id).reports.at(-1)!.delivery).toBe('pending');
    await kit.send(kit.main.conversationId, 'Anything new?');
    await kit.until(() => kit.bot.getItem(item.id).reports.find((r) => r.id === report.id)?.delivery === 'delivered');
    await kit.settle();
    expect(reportItems().map((i) => i.kind === 'relay' && i.reportId)).toContain(report.id);
  });

  it('S4: a report dropped while the Driver was unavailable is relayed once the Driver is back', async () => {
    kit.thread = async (ctx) => {
      // 线程回合跑着时 Driver 变得不可用：报告存下了，转述给协调者时起不了回合。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (kit.driver as any).verified = false;
      await ctx.call('thread_report', { stop: 'needs-review', headline: 'The poster is ready.' });
    };
    const item = await kit.bot.createItem({ channelId: kit.main.id, title: 'Make the poster', owner: 'agent' });
    await kit.bot.startItem(item.id, { attended: false });
    await kit.until(() => kit.item(item.id).active?.state === 'needsReview');
    await kit.settle();
    const report = kit.bot.getItem(item.id).reports.at(-1)!;
    expect(report.delivery).toBe('pending');
    expect(reportItems()).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (kit.driver as any).verified = true;
    kit.harness.agentsChanged();
    await kit.until(() => kit.bot.getItem(item.id).reports.find((r) => r.id === report.id)?.delivery === 'delivered');
    await kit.settle();
    expect(reportItems().map((i) => i.kind === 'relay' && i.reportId)).toContain(report.id);
  });
});

describe('the user talks to a thread that is waiting', () => {
  it('C1: a message from the user in a waiting thread moves the task back to working first, so the turn can report', async () => {
    kit.thread = (ctx) => ctx.call('thread_report', { stop: 'waiting', headline: 'The dub is rendering.', waitingFor: { jobIds: ['job_dub_9'] } });
    const item = await kit.startTask('Dub the trailer');
    expect(kit.item(item.id).active?.state).toBe('waitingOnOthers');
    const result = await kit.threadTurn(item.id, 'Skip the dub, the subtitles are enough.', (ctx) =>
      ctx.tryCall('thread_report', { stop: 'needs-review', headline: 'Subtitles only, no dub.' }),
    );
    await kit.settle();
    expect(result.ok).toBe(true);
    expect(kit.item(item.id).active?.state).toBe('needsReview');
    expect(kit.bot.getItem(item.id).transitions.map((t) => `${t.cause}->${t.to}`)).toContain('unblocked:user-replied->working');
  });
});

describe('deleting a channel', () => {
  it('I13: deleting a channel deletes the schedules the confirmation counted', async () => {
    const channel = await kit.bot.createChannel({ name: 'Clips' });
    kit.schedules.perChannel.set(channel.id, 2);
    await kit.bot.deleteChannel(channel.id, { threads: 0, schedules: 2 });
    expect(kit.schedules.deleted).toEqual([channel.id]);
    expect(kit.bot.listChannels().some((c) => c.channel.id === channel.id)).toBe(false);
  });

  it('I13: a delete that fails half way leaves no channel behind and is finished at the next start', async () => {
    const channel = await kit.bot.createChannel({ name: 'Clips' });
    const item = await kit.bot.createItem({ channelId: channel.id, title: 'Cut the teaser', owner: 'agent' });
    await kit.bot.startItem(item.id, { attended: true });
    await kit.until(() => kit.item(item.id).threadId && kit.harness.conversationOf(kit.threadOf(item.id))?.activity === 'idle');
    await kit.settle();
    const thread = kit.threadOf(item.id);
    // 删会话这一步出错（相当于删到一半崩了）。
    const original = kit.harness.deleteConversation.bind(kit.harness);
    kit.harness.deleteConversation = (async () => {
      throw new Error('disk went away');
    }) as typeof kit.harness.deleteConversation;
    await kit.bot.deleteChannel(channel.id, { threads: 1, schedules: 0 });
    kit.harness.deleteConversation = original;
    expect(kit.bot.listChannels().some((c) => c.channel.id === channel.id)).toBe(false);
    expect(kit.harness.conversationOf(thread)).toBeTruthy();
    await kit.restart();
    expect(kit.bot.listChannels().some((c) => c.channel.id === channel.id)).toBe(false);
    expect(kit.harness.conversationOf(thread)).toBeUndefined();
    expect(kit.harness.conversationOf(channel.conversationId)).toBeUndefined();
    const saved = JSON.parse(await fs.readFile(kit.home.channelsFile, 'utf8')) as { channels: { id: string }[]; deletedChannels?: string[] };
    expect(saved.channels.map((c) => c.id)).not.toContain(channel.id);
    expect(saved.deletedChannels).toBeUndefined();
  });
});

describe('a delivery held for "continue" goes stale', () => {
  /** 盘上为这条任务留着的那一份（`held/<id>.json`）。 */
  async function heldFiles(id: Id): Promise<string[]> {
    const all = (await fs.readdir(kit.dir, { recursive: true })) as string[];
    return all.filter((f) => f.split(path.sep).includes('held') && f.endsWith(`${id}.json`));
  }

  async function heldLaunch(title: string) {
    await kit.close();
    kit = await BotKit.open({ approvals: false });
    await kit.bot.updateChannel(kit.main.id, { defaultAccessMode: 'fullAccess' });
    const item = await kit.bot.createItem({ channelId: kit.main.id, title, owner: 'agent' });
    await kit.bot.startItem(item.id, { attended: false, brief: 'Use the calm voice.' });
    await kit.settle();
    expect(kit.item(item.id)).toMatchObject({ active: { state: 'needsInput' }, question: { askedBy: 'system' } });
    expect(await heldFiles(item.id)).toHaveLength(1);
    return item;
  }

  it('I11: after the user answers in the thread instead of pressing Continue, a later Continue does not deliver the old brief again', async () => {
    const item = await heldLaunch('Voice-over for episode 5');
    await kit.threadTurn(item.id, 'Go ahead with the calm voice.', (ctx) => ctx.call('thread_report', { stop: 'blocked', headline: 'The voice file is missing.' }));
    await kit.settle();
    expect(kit.item(item.id).active?.state).toBe('blocked');
    expect(await heldFiles(item.id)).toEqual([]);
    const thread = kit.threadOf(item.id);
    const before = kit.turns(thread).length;
    kit.thread = () => {};
    await kit.bot.userTransition(item.id, { type: 'unblocked', cause: 'user' });
    await kit.settle();
    const after = kit.turns(thread).slice(before);
    expect(after).toHaveLength(1);
    expect(after[0]).not.toContain('<baocut-thread-brief');
    expect(after[0]).toContain('<baocut-refresh');
  });

  it('I11: a task that is resolved while its launch is held leaves no held file behind', async () => {
    const item = await heldLaunch('Voice-over for episode 6');
    await kit.bot.userTransition(item.id, { type: 'resolve', evidence: null });
    await kit.settle();
    expect(kit.item(item.id).status).toBe('resolved');
    expect(await heldFiles(item.id)).toEqual([]);
  });
});

describe('follow-ups in a report go through Make', () => {
  const suggested = () => kit.bot.listItems(kit.main.id).filter((i) => i.status === 'suggested');
  const reportWith = (followUps: string[], before?: () => Promise<unknown>) => {
    let done = false;
    kit.thread = async (ctx) => {
      if (done) return;
      done = true;
      await before?.();
      await ctx.call('thread_report', { stop: 'needs-review', headline: 'The trailer is cut.', followUps });
    };
  };

  it('I9: a follow-up that is not local editing work (no allowed kind) does not become a suggestion', async () => {
    reportWith(['Call the venue about Friday', 'Make shorts from the trailer']);
    await kit.startTask('Cut the trailer');
    await kit.settle();
    expect(suggested().map((i) => [i.title, i.suggestion?.kindTag, i.suggestion?.trigger])).toEqual([['Make shorts from the trailer', 'shorts', 'thread-report']]);
  });

  it('I9: follow-ups are not suggested while all automation is paused', async () => {
    reportWith(['Make shorts from the trailer'], () => kit.bot.updateSettings({ automationPaused: true }));
    await kit.startTask('Cut the trailer');
    await kit.settle();
    expect(suggested()).toEqual([]);
  });

  it('I9: follow-ups count as an automatic Make run and stop once three ran today', async () => {
    for (let i = 0; i < 3; i++) await kit.bot.runMake(kit.main.id, 'item-resolved');
    expect(kit.make.inputs).toHaveLength(3);
    reportWith(['Make shorts from the trailer']);
    await kit.startTask('Cut the trailer');
    await kit.settle();
    expect(suggested()).toEqual([]);
  });
});

describe('Make filters and limits', () => {
  const suggested = () => kit.bot.listItems(kit.main.id).filter((i) => i.status === 'suggested');
  const candidate = (title: string, kindTag: string) => ({ title, reason: 'Seen in the channel.', kindTag, evidence: [] });

  it('I20: words like "reorder" and "border" pass, while publishing in Chinese or with an inflected verb is dropped', async () => {
    kit.make.candidates = [
      // 发布到 B 站 / 上传到 YouTube：外发，不许。
      candidate('发布到 B 站', 'export'),
      candidate('上传到 YouTube', 'export'),
      candidate('Shorts posted to the channel', 'shorts'),
      candidate('Reorder the chapters', 'chapters'),
      candidate('Add a border to the thumbnail', 'add-border'),
    ];
    const run = await kit.bot.runMake(kit.main.id, 'manual');
    expect(run.shown).toBe(2);
    expect(suggested().map((i) => i.title).sort()).toEqual(['Add a border to the thumbnail', 'Reorder the chapters']);
  });

  it('I20: an automatic run with the suggestion slots full does not call the model and does not use up a daily run', async () => {
    kit.make.candidates = [candidate('Trim the intro', 'trim'), candidate('Add captions', 'add-captions'), candidate('Export a vertical cut', 'export')];
    expect((await kit.bot.runMake(kit.main.id, 'manual')).shown).toBe(3);
    expect(kit.make.inputs).toHaveLength(1);
    for (let i = 0; i < 3; i++) expect((await kit.bot.runMake(kit.main.id, 'item-resolved')).shown).toBe(0);
    expect(kit.make.inputs).toHaveLength(1);
    for (const item of suggested()) await kit.bot.userTransition(item.id, { type: 'dismiss' });
    kit.make.candidates = [candidate('Make chapters for the long cut', 'chapters')];
    expect((await kit.bot.runMake(kit.main.id, 'item-resolved')).shown).toBe(1);
    expect(kit.make.inputs).toHaveLength(2);
  });
});
