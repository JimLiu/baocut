import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, type Id } from '@baocut/protocol';
import { BotKit, escalate } from './testing/bot-kit.ts';
import { stateName } from './work-item-machine.ts';

/* 一次性定时遇上归档与暂停，任务跨频道移动时线程跟着走（BOT-TK-09）。 */

let kit: BotKit;
beforeEach(async () => {
  kit = await BotKit.open();
});
afterEach(async () => {
  await kit.close();
});

async function scheduledIn(channelId: string, title: string, inMs: number) {
  const item = await kit.bot.createItem({ channelId, title, owner: 'agent' });
  return kit.bot.userTransition(item.id, { type: 'schedule', startAt: new Date(kit.clock.now() + inMs).toISOString() });
}

describe('one-shot timers', () => {
  it('an archived channel does not start its scheduled items, and starts them once unarchived', async () => {
    const channel = await kit.bot.createChannel({ name: 'Later' });
    const others = kit.clock.timers.size;
    const item = await scheduledIn(channel.id, 'Cut the trailer', 60_000);
    expect(kit.clock.timers.size).toBe(others + 1);
    await kit.bot.archiveChannel(channel.id, true);
    expect(kit.clock.timers.size).toBe(others);
    kit.clock.offset = 2 * 60_000;
    await kit.bot.fireDue();
    expect(kit.item(item.id).status).toBe('scheduled');
    expect(kit.clock.timers.size).toBe(others);
    await kit.bot.archiveChannel(channel.id, false);
    await kit.until(() => kit.item(item.id).status !== 'scheduled');
    await kit.settle();
  });

  it('archiving a channel stops its working tasks so they no longer hold a slot', async () => {
    const channel = await kit.bot.createChannel({ name: 'Later' });
    kit.thread = (ctx) => ctx.turn.hold();
    const item = await kit.bot.createItem({ channelId: channel.id, title: 'Render the long cut', owner: 'agent' });
    await kit.bot.startItem(item.id, { attended: true });
    await kit.until(() => kit.item(item.id).threadId && kit.harness.conversationOf(kit.threadOf(item.id))?.activity === 'running');
    expect(stateName(kit.item(item.id))).toBe('working');
    await kit.bot.archiveChannel(channel.id, true);
    await kit.settle();
    expect(kit.item(item.id).active?.state).toBe('blocked');
    expect(kit.harness.conversationOf(kit.threadOf(item.id))!.activeTaskId).toBeFalsy();
  });

  it('while automation is paused no timer is armed, and a due item runs when it resumes', async () => {
    const others = kit.clock.timers.size;
    const item = await scheduledIn(kit.main.id, 'Make chapters', 60_000);
    expect(kit.clock.timers.size).toBe(others + 1);
    await kit.bot.pauseAutomation(true);
    expect(kit.clock.timers.size).toBe(others);
    kit.clock.offset = 2 * 60_000;
    await kit.bot.fireDue();
    expect(kit.item(item.id).status).toBe('scheduled');
    expect(kit.clock.timers.size).toBe(others);
    await kit.bot.pauseAutomation(false);
    await kit.until(() => kit.item(item.id).status !== 'scheduled');
    await kit.settle();
  });
});

describe('moving a task', () => {
  it('BOT-TK-09 the thread follows the task: its channel, working folder and notes move too', async () => {
    const item = await kit.startTask('Draft captions');
    const threadId = kit.threadOf(item.id);
    const oldNotes = kit.bot.notesPath(kit.item(item.id))!;
    await fs.mkdir(path.dirname(oldNotes), { recursive: true });
    await fs.writeFile(oldNotes, 'step 1 done');
    const target = await kit.bot.createChannel({ name: 'Captions' });
    const moved = await kit.bot.moveItem(item.id, target.id);
    expect(moved.channelId).toBe(target.id);
    const thread = kit.harness.conversationOf(threadId)!;
    expect(thread.channelId).toBe(target.id);
    expect(thread.cwd).toBe(kit.bot.filesDir(target.id));
    const newNotes = kit.bot.notesPath(kit.item(item.id))!;
    expect(newNotes).not.toBe(oldNotes);
    expect(await fs.readFile(newNotes, 'utf8')).toBe('step 1 done');
    await expect(fs.access(oldNotes)).rejects.toThrow();
  });

  it('a thread waiting on an approval cannot be moved, and its notes stay where they were', async () => {
    kit.thread = (ctx) => void escalate(ctx, 'voice-generate --segment 1');
    const item = await kit.bot.createItem({ channelId: kit.main.id, title: 'Voice the intro', owner: 'agent' });
    await kit.bot.startItem(item.id, { attended: true });
    await kit.until(() => kit.item(item.id).threadId && kit.harness.conversationOf(kit.threadOf(item.id))?.activity === 'awaiting-approval');
    const oldNotes = kit.bot.notesPath(kit.item(item.id))!;
    await fs.mkdir(path.dirname(oldNotes), { recursive: true });
    await fs.writeFile(oldNotes, 'waiting for approval');
    const target = await kit.bot.createChannel({ name: 'Voice' });
    await expect(kit.bot.moveItem(item.id, target.id)).rejects.toMatchObject({ code: 'busy' });
    expect(kit.item(item.id).channelId).toBe(kit.main.id);
    expect(kit.harness.conversationOf(kit.threadOf(item.id))!.channelId).toBe(kit.main.id);
    expect(await fs.readFile(oldNotes, 'utf8')).toBe('waiting for approval');
    await kit.bot.stopItem(item.id);
    await kit.settle();
  });

  it('BOT-TK-09 the task keeps its reports and history after a move, also across a restart', async () => {
    kit.thread = (ctx) => ctx.call('thread_report', { stop: 'blocked', headline: 'The source file is missing.' });
    const item = await kit.startTask('Fix the audio');
    await kit.until(() => kit.item(item.id).lastReportId);
    await kit.settle();
    const before = kit.bot.getItem(item.id);
    expect(before.reports.length).toBeGreaterThan(0);
    expect(before.transitions.length).toBeGreaterThan(0);
    const target = await kit.bot.createChannel({ name: 'Audio' });
    await kit.bot.moveItem(item.id, target.id);
    const after = kit.bot.getItem(item.id);
    expect(after.reports.map((r) => r.id)).toEqual(before.reports.map((r) => r.id));
    expect(after.transitions).toEqual(before.transitions);
    await kit.restart();
    const reloaded = kit.bot.getItem(item.id);
    expect(reloaded.item.channelId).toBe(target.id);
    expect(reloaded.reports.map((r) => r.id)).toEqual(before.reports.map((r) => r.id));
    expect(reloaded.transitions.map((t) => [t.from, t.to])).toEqual(before.transitions.map((t) => [t.from, t.to]));
    expect(kit.bot.getItem(item.id).item.lastReportId).toBe(before.item.lastReportId);
  });
});

describe('inbox questions', () => {
  const ratio = (id: string) => ({
    id,
    header: 'Format',
    question: 'Which aspect ratio?',
    options: [
      { label: '16:9', description: '' },
      { label: '9:16', description: '' },
    ],
    multiSelect: false,
    allowOther: false,
  });

  /** 线程在回合里提一张提问卡，回合停着等回答。 */
  async function ask(questions: unknown[]) {
    const approvalId = newId('ap');
    let finish: () => void = () => {};
    let asked = false;
    kit.thread = (ctx) => {
      if (asked) return;
      asked = true;
      ctx.turn.hold();
      finish = () => ctx.turn.complete();
      ctx.turn.session.emit({
        type: 'approval.requested',
        turnId: ctx.turn.session.turnId!,
        approvalId,
        request: { kind: 'question', reason: null, rule: null, questions },
      } as never);
    };
    const item = await kit.startTask('Cut a short');
    await kit.until(() => kit.item(item.id).question?.approvalId === approvalId);
    return { item, approvalId, finish: () => finish() };
  }

  it('a question card on a thread carries its question id, so the inbox can answer without opening the thread', async () => {
    const { item, approvalId, finish } = await ask([ratio('q1')]);
    expect(kit.item(item.id).question).toMatchObject({ approvalId, questionId: 'q1' });
    expect(kit.bot.inbox().find((r) => r.workItemId === item.id)?.question).toMatchObject({ questionId: 'q1' });
    finish();
    await kit.settle();
  });

  it('a card with several questions or a multiple choice offers no one-tap answers; it is answered in the thread', async () => {
    const { item, finish } = await ask([ratio('q1'), { ...ratio('q2'), question: 'Which length?' }]);
    expect(kit.item(item.id).question).toMatchObject({ options: [], questionId: null, askedBy: 'thread' });
    finish();
    await kit.settle();
    await kit.close();
    kit = await BotKit.open();
    const multi = await ask([{ ...ratio('q1'), multiSelect: true }]);
    expect(kit.item(multi.item.id).question).toMatchObject({ options: [], questionId: null });
    multi.finish();
    await kit.settle();
  });
});

describe('video access for threads', () => {
  it('a thread may open the videos in its task resources; the coordinator and other threads may not', async () => {
    const withVideo = await kit.startTask('Trim episode 4', { resources: [{ kind: 'video', projectId: 'proj_1', videoId: 'video_0123456789abcdef' }] });
    const plain = await kit.startTask('Write a summary');
    const thread = kit.harness.conversationOf(kit.threadOf(withVideo.id))!;
    expect(kit.bot.videoProjectsOf(thread)).toEqual(['proj_1']);
    expect(kit.bot.videoProjectsOf(kit.harness.conversationOf(kit.threadOf(plain.id))!)).toEqual([]);
    expect(kit.bot.videoProjectsOf(kit.harness.conversationOf(kit.main.conversationId)!)).toEqual([]);
  });
});

describe('queued tasks across a restart', () => {
  it('a queued task keeps its brief and file ownership when the runtime restarts before it starts', async () => {
    const first = await kit.startTask('Color grade episode 7');
    const second = await kit.coordinatorTurn('Also add captions to episode 7', (ctx) =>
      ctx.call<{ workItemId: Id; queued: boolean }>('thread_start', {
        create: { title: 'Add captions to episode 7', sourceMessageId: kit.bot.runOf(ctx.conversationId)!.userMessageId!, dependsOn: [first.id] },
        citedMessageIds: [kit.bot.runOf(ctx.conversationId)!.userMessageId!],
        brief: 'Use the house caption style.',
        fileOwnership: 'Only new caption files.',
      }),
    );
    expect(second.queued).toBe(true);
    await kit.restart();
    await kit.bot.userTransition(first.id, { type: 'resolve', evidence: null });
    await kit.until(() => kit.item(second.workItemId).threadId);
    await kit.settle();
    const brief = kit.turns(kit.threadOf(second.workItemId))[0]!;
    expect(brief).toContain('Use the house caption style.');
    expect(brief).toContain('file ownership: Only new caption files.');
  });
});
