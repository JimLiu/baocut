import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, type Id } from '@baocut/protocol';
import { RcBot } from '@baocut/protocol/messages/runtime-core';
import { ChannelFiles, WorkItemStore } from '@baocut/runtime-storage';
import { BotKit, escalate, userMessageIn, type TurnContext } from './testing/bot-kit.ts';
import { stateName } from './work-item-machine.ts';

/* 一次性定时遇上归档与暂停，任务跨频道移动时线程跟着走（BOT-TK-09）。 */

let kit: BotKit;
beforeEach(async () => {
  kit = await BotKit.open();
});
afterEach(async () => {
  await kit.close();
});

function firstTurn(fn: (ctx: TurnContext) => Promise<void>) {
  const seen = new Set<string>();
  return async (ctx: TurnContext) => {
    if (seen.has(ctx.conversationId)) return;
    seen.add(ctx.conversationId);
    await fn(ctx);
  };
}

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

  it('a scheduled item moved out of an archived channel gets its timer back, and starts at once if it is already due', async () => {
    const channel = await kit.bot.createChannel({ name: 'Later' });
    const others = kit.clock.timers.size;
    const later = await scheduledIn(channel.id, 'Cut the trailer', 10 * 60_000);
    const due = await scheduledIn(channel.id, 'Render the teaser', 60_000);
    await kit.bot.archiveChannel(channel.id, true);
    expect(kit.clock.timers.size).toBe(others);
    kit.clock.offset = 2 * 60_000;
    await kit.bot.moveItem(later.id, kit.main.id);
    // 没到点的：一次性定时重新挂上。
    expect(kit.item(later.id).status).toBe('scheduled');
    expect(kit.clock.timers.size).toBe(others + 1);
    // 已经过点的：移过去就开。
    await kit.bot.moveItem(due.id, kit.main.id);
    await kit.until(() => kit.item(due.id).status !== 'scheduled');
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

  it('archiving does not let a task queued behind the thread limit take the freed slot', async () => {
    const channel = await kit.bot.createChannel({ name: 'Later' });
    await kit.bot.updateChannel(channel.id, { concurrentThreads: 1 });
    kit.thread = (ctx) => ctx.turn.hold();
    const first = await kit.bot.createItem({ channelId: channel.id, title: 'Render the long cut', owner: 'agent' });
    await kit.bot.startItem(first.id, { attended: true });
    await kit.until(() => kit.item(first.id).threadId && kit.harness.conversationOf(kit.threadOf(first.id))?.activity === 'running');
    const queued = await kit.bot.createItem({ channelId: channel.id, title: 'Render the short cut', owner: 'agent' });
    await kit.bot.startItem(queued.id, { attended: true });
    expect(kit.item(queued.id)).toMatchObject({ status: 'upNext', threadId: null });
    await kit.bot.archiveChannel(channel.id, true);
    await kit.settle();
    expect(kit.item(first.id).active?.state).toBe('blocked');
    expect(kit.item(queued.id)).toMatchObject({ status: 'upNext', threadId: null });
  });

  it('a task queued behind the thread limit starts once it is moved to a channel with a free slot', async () => {
    const channel = await kit.bot.createChannel({ name: 'Later' });
    await kit.bot.updateChannel(channel.id, { concurrentThreads: 1 });
    kit.thread = (ctx) => ctx.turn.hold();
    const first = await kit.bot.createItem({ channelId: channel.id, title: 'Render the long cut', owner: 'agent' });
    await kit.bot.startItem(first.id, { attended: true });
    await kit.until(() => kit.item(first.id).threadId && kit.harness.conversationOf(kit.threadOf(first.id))?.activity === 'running');
    const queued = await kit.bot.createItem({ channelId: channel.id, title: 'Render the short cut', owner: 'agent' });
    await kit.bot.startItem(queued.id, { attended: true });
    expect(kit.item(queued.id)).toMatchObject({ status: 'upNext', threadId: null });
    const free = await kit.bot.createChannel({ name: 'Free' });
    await kit.bot.moveItem(queued.id, free.id);
    await kit.until(() => kit.item(queued.id).threadId);
    expect(kit.item(queued.id)).toMatchObject({ channelId: free.id, status: 'active' });
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
    // 笔记在线程的工作目录里：智能体的沙箱只放行 cwd 时也写得了。
    expect(newNotes.startsWith(thread.cwd + path.sep)).toBe(true);
    expect(newNotes).not.toBe(oldNotes);
    expect(await fs.readFile(newNotes, 'utf8')).toBe('step 1 done');
    await expect(fs.access(oldNotes)).rejects.toThrow();
  });

  it('a thread moved into a channel with a lower ceiling is lowered to it, so a finished job cannot wake it above the ceiling', async () => {
    await kit.bot.updateChannel(kit.main.id, { defaultAccessMode: 'auto' });
    const item = await kit.startTask('Render the teaser');
    const threadId = kit.threadOf(item.id);
    expect(kit.harness.conversationMode(threadId)).toBe('auto');
    const target = await kit.bot.createChannel({ name: 'Planning' });
    await kit.bot.updateChannel(target.id, { maxAccessMode: 'plan' });
    await kit.bot.moveItem(item.id, target.id);
    expect(kit.harness.conversationOf(threadId)!.accessMode).toBe('plan');
    expect(kit.harness.conversationMode(threadId)).toBe('plan');
  });

  it('BOT-TK-09 the task files move into the new channel folder and the references follow them', async () => {
    const fromDir = kit.bot.filesDir(kit.main.id);
    await fs.mkdir(fromDir, { recursive: true });
    await fs.writeFile(path.join(fromDir, 'draft.srt'), 'own captions');
    await fs.mkdir(path.join(fromDir, 'out'), { recursive: true });
    await fs.writeFile(path.join(fromDir, 'out', 'cut.txt'), 'own output');
    await fs.writeFile(path.join(fromDir, 'script.md'), 'shared script');
    await fs.writeFile(path.join(fromDir, 'notes.txt'), 'mine');
    await fs.writeFile(path.join(fromDir, 'same.txt'), 'identical');
    const item = await kit.startTask('Draft captions');
    await kit.bot.patchItemContent(
      item.id,
      (i) => ({
        ...i,
        resources: [
          { kind: 'file', path: 'draft.srt' },
          { kind: 'file', path: 'script.md' },
          { kind: 'file', path: '/elsewhere/source.mov' },
        ],
        outputs: [{ kind: 'file', path: path.join(fromDir, 'out', 'cut.txt'), label: 'Cut list', version: null }],
        files: ['notes.txt', 'same.txt'],
      }),
      false,
    );
    // 另一个任务也在用 script.md：它留在原处，新频道拿一份副本。
    await kit.bot.createItem({ channelId: kit.main.id, title: 'Voice over', owner: 'user', resources: [{ kind: 'file', path: 'script.md' }] });
    const target = await kit.bot.createChannel({ name: 'Captions' });
    const toDir = kit.bot.filesDir(target.id);
    await fs.mkdir(toDir, { recursive: true });
    await fs.writeFile(path.join(toDir, 'notes.txt'), 'someone else');
    await fs.writeFile(path.join(toDir, 'same.txt'), 'identical');

    const moved = await kit.bot.moveItem(item.id, target.id);

    expect(moved.resources).toEqual([
      { kind: 'file', path: 'draft.srt' },
      { kind: 'file', path: 'script.md' },
      { kind: 'file', path: '/elsewhere/source.mov' },
    ]);
    expect(moved.outputs[0]).toMatchObject({ path: path.join(toDir, 'out', 'cut.txt') });
    // 新频道里同名不同内容的换个名字，同名同内容的直接用那份。
    expect(moved.files).toEqual(['notes (2).txt', 'same.txt']);
    expect(await fs.readFile(path.join(toDir, 'draft.srt'), 'utf8')).toBe('own captions');
    expect(await fs.readFile(path.join(toDir, 'out', 'cut.txt'), 'utf8')).toBe('own output');
    expect(await fs.readFile(path.join(toDir, 'script.md'), 'utf8')).toBe('shared script');
    expect(await fs.readFile(path.join(toDir, 'notes (2).txt'), 'utf8')).toBe('mine');
    expect(await fs.readFile(path.join(toDir, 'notes.txt'), 'utf8')).toBe('someone else');
    expect(await fs.readFile(path.join(fromDir, 'script.md'), 'utf8')).toBe('shared script');
    await expect(fs.access(path.join(fromDir, 'draft.srt'))).rejects.toThrow();
    await expect(fs.access(path.join(fromDir, 'notes.txt'))).rejects.toThrow();
    await expect(fs.access(path.join(fromDir, 'same.txt'))).rejects.toThrow();
  });

  it('BOT-TK-09 when the thread cannot move, the task files go back where they were', async () => {
    const fromDir = kit.bot.filesDir(kit.main.id);
    await fs.mkdir(fromDir, { recursive: true });
    await fs.writeFile(path.join(fromDir, 'draft.srt'), 'own captions');
    const item = await kit.startTask('Draft captions');
    await kit.bot.patchItemContent(item.id, (i) => ({ ...i, resources: [{ kind: 'file', path: 'draft.srt' }] }), false);
    const target = await kit.bot.createChannel({ name: 'Captions' });
    kit.harness.moveThread = async () => {
      throw new Error('disk full');
    };
    await expect(kit.bot.moveItem(item.id, target.id)).rejects.toThrow('disk full');
    expect(await fs.readFile(path.join(fromDir, 'draft.srt'), 'utf8')).toBe('own captions');
    await expect(fs.access(path.join(kit.bot.filesDir(target.id), 'draft.srt'))).rejects.toThrow();
    expect(kit.item(item.id).channelId).toBe(kit.main.id);
  });

  it('BOT-EX-20 deleting a task record removes only the files no other task uses', async () => {
    const dir = kit.bot.filesDir(kit.main.id);
    await fs.mkdir(dir, { recursive: true });
    for (const name of ['mine.srt', 'script.md', 'cut.txt', 'shared.txt']) await fs.writeFile(path.join(dir, name), name);
    const item = await kit.bot.createItem({ channelId: kit.main.id, title: 'Draft captions', owner: 'user' });
    await kit.bot.patchItemContent(item.id, (i) => ({ ...i, files: ['mine.srt', 'script.md', path.join(dir, 'cut.txt'), 'shared.txt'] }), false);
    // 别的任务拿 script.md 当资源、cut.txt（绝对路径）当产出、shared.txt 也写过：都不删。
    const other = await kit.bot.createItem({ channelId: kit.main.id, title: 'Voice over', owner: 'user', resources: [{ kind: 'file', path: 'script.md' }] });
    await kit.bot.patchItemContent(other.id, (i) => ({ ...i, outputs: [{ kind: 'file', path: path.join(dir, 'cut.txt'), label: 'Cut', version: null }], files: ['shared.txt'] }), false);
    const plan = await kit.bot.deleteRecord(item.id, true);
    expect(plan.files).toEqual(['mine.srt']);
    expect([...plan.keptShared].sort()).toEqual(['cut.txt', 'script.md', 'shared.txt']);
    await kit.bot.deleteRecord(item.id, false, { files: plan.files });
    await expect(fs.access(path.join(dir, 'mine.srt'))).rejects.toThrow();
    for (const name of ['script.md', 'cut.txt', 'shared.txt']) expect(await fs.readFile(path.join(dir, name), 'utf8')).toBe(name);
  });

  it('BOT-EX-20 deleting a task that another thread reported waiting on wakes that thread', async () => {
    const other = await kit.bot.createItem({ channelId: kit.main.id, title: 'Approve the music license', owner: 'user' });
    const turns = new Map<Id, number>();
    kit.thread = async (ctx) => {
      const n = (turns.get(ctx.conversationId) ?? 0) + 1;
      turns.set(ctx.conversationId, n);
      if (n === 1) await ctx.call('thread_report', { stop: 'waiting', headline: 'Waiting for the music license.', waitingFor: { workItemIds: [other.id] } });
      if (n === 2) await ctx.call('thread_report', { stop: 'needs-review', headline: 'Used library music instead.' });
    };
    const item = await kit.startTask('Add music to the trailer');
    expect(stateName(kit.item(item.id))).toBe('waitingOnOthers');
    const plan = await kit.bot.deleteRecord(other.id, true);
    await kit.bot.deleteRecord(other.id, false, { files: plan.files });
    await kit.until(() => stateName(kit.item(item.id)) === 'needsReview');
    await kit.settle();
    const woke = kit.turns(kit.threadOf(item.id)).at(-1)!;
    expect(woke).toContain('<baocut-refresh reason="dependency-resolved">');
    expect(woke).toContain('was deleted');
  });

  it('BOT-EX-20 deleting a channel wakes a task in another channel that reported waiting on one of its tasks', async () => {
    const channel = await kit.bot.createChannel({ name: 'Licensing' });
    const other = await kit.bot.createItem({ channelId: channel.id, title: 'Approve the music license', owner: 'user' });
    const turns = new Map<Id, number>();
    kit.thread = async (ctx) => {
      const n = (turns.get(ctx.conversationId) ?? 0) + 1;
      turns.set(ctx.conversationId, n);
      if (n === 1) await ctx.call('thread_report', { stop: 'waiting', headline: 'Waiting for the music license.', waitingFor: { workItemIds: [other.id] } });
      if (n === 2) await ctx.call('thread_report', { stop: 'needs-review', headline: 'Used library music instead.' });
    };
    const item = await kit.startTask('Add music to the trailer');
    expect(stateName(kit.item(item.id))).toBe('waitingOnOthers');
    await kit.bot.deleteChannel(channel.id, { threads: 0, schedules: 0 });
    await kit.until(() => stateName(kit.item(item.id)) === 'needsReview');
    await kit.settle();
    expect(kit.turns(kit.threadOf(item.id)).at(-1)!).toContain('was deleted');
  });

  it('BOT-EX-20 deleting a task that a queued task depends on lets the queued task start', async () => {
    kit.thread = firstTurn(async (ctx) => {
      await ctx.call('thread_report', { stop: 'needs-review', headline: 'Trailer cut.' });
    });
    const first = await kit.bot.createItem({ channelId: kit.main.id, title: 'Pick the shots', owner: 'user' });
    const next = await kit.bot.createItem({ channelId: kit.main.id, title: 'Cut the trailer', owner: 'agent', dependsOn: [first.id] });
    await kit.bot.startItem(next.id, { attended: false });
    expect(kit.item(next.id).status).toBe('upNext');
    const plan = await kit.bot.deleteRecord(first.id, true);
    await kit.bot.deleteRecord(first.id, false, { files: plan.files });
    await kit.until(() => stateName(kit.item(next.id)) === 'needsReview');
  });

  it('BOT-EX-20 deleting a task record removes its held and queued launch files', async () => {
    const files = new ChannelFiles(kit.home.channelsDir);
    const blocker = await kit.bot.createItem({ channelId: kit.main.id, title: 'Pick the shots', owner: 'user' });
    const item = await kit.bot.createItem({ channelId: kit.main.id, title: 'Cut the trailer', owner: 'agent', dependsOn: [blocker.id] });
    await kit.bot.startItem(item.id, { attended: false, brief: 'Use the wide shots.' });
    expect(await files.readQueued(kit.main.id, item.id)).not.toBeNull();
    await files.writeHeld(kit.main.id, item.id, { conversationId: 'conv_x', text: 'held' });
    const plan = await kit.bot.deleteRecord(item.id, true);
    await kit.bot.deleteRecord(item.id, false, { files: plan.files });
    expect(await files.readQueued(kit.main.id, item.id)).toBeNull();
    expect(await files.readHeld(kit.main.id, item.id)).toBeNull();
  });

  it('BOT-EX-20 deleting a task record does not list or delete a file reached through a symlink that leaves the channel folder', async () => {
    const dir = kit.bot.filesDir(kit.main.id);
    await fs.mkdir(dir, { recursive: true });
    const outside = path.join(kit.dir, 'outside');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'source.txt'), 'keep me');
    await fs.symlink(outside, path.join(dir, 'linked'), 'dir');
    await fs.writeFile(path.join(dir, 'mine.txt'), 'mine');
    const item = await kit.bot.createItem({ channelId: kit.main.id, title: 'Draft captions', owner: 'user' });
    await kit.bot.patchItemContent(
      item.id,
      (i) => ({ ...i, files: ['mine.txt'], outputs: [{ kind: 'file', path: path.join('linked', 'source.txt'), label: 'Source', version: null }] }),
      false,
    );
    const plan = await kit.bot.deleteRecord(item.id, true);
    expect(plan.files).toEqual(['mine.txt']);
    await kit.bot.deleteRecord(item.id, false, { files: plan.files });
    expect(await fs.readFile(path.join(outside, 'source.txt'), 'utf8')).toBe('keep me');
    await expect(fs.access(path.join(dir, 'mine.txt'))).rejects.toThrow();
  });

  it('moving a task does not carry a file reached through a symlink out of the channel folder, nor write through one in the new channel', async () => {
    const fromDir = kit.bot.filesDir(kit.main.id);
    await fs.mkdir(fromDir, { recursive: true });
    const outside = path.join(kit.dir, 'outside-move');
    const outsideTarget = path.join(kit.dir, 'outside-target');
    await fs.mkdir(outside, { recursive: true });
    await fs.mkdir(outsideTarget, { recursive: true });
    await fs.writeFile(path.join(outside, 'source.txt'), 'keep me here');
    await fs.symlink(outside, path.join(fromDir, 'linked'), 'dir');
    await fs.mkdir(path.join(fromDir, 'out'), { recursive: true });
    await fs.writeFile(path.join(fromDir, 'out', 'cut.txt'), 'own output');
    const item = await kit.bot.createItem({ channelId: kit.main.id, title: 'Draft captions', owner: 'user' });
    await kit.bot.patchItemContent(item.id, (i) => ({ ...i, files: [path.join('linked', 'source.txt'), path.join('out', 'cut.txt')] }), false);
    const target = await kit.bot.createChannel({ name: 'Captions' });
    const toDir = kit.bot.filesDir(target.id);
    await fs.mkdir(toDir, { recursive: true });
    // 新频道的 out 指到外面：任务的 out/cut.txt 不能经它写出去。外面恰好有一份内容相同的，也不能当成同一个文件把原件删掉。
    await fs.symlink(outsideTarget, path.join(toDir, 'out'), 'dir');
    await fs.writeFile(path.join(outsideTarget, 'cut.txt'), 'own output');

    await kit.bot.moveItem(item.id, target.id);

    expect(await fs.readFile(path.join(outside, 'source.txt'), 'utf8')).toBe('keep me here');
    await expect(fs.access(path.join(toDir, 'linked'))).rejects.toThrow();
    expect(await fs.readdir(outsideTarget)).toEqual(['cut.txt']);
    expect(await fs.readFile(path.join(fromDir, 'out', 'cut.txt'), 'utf8')).toBe('own output');
  });

  it('BOT-EX-20 deleting a task record tells the schedules, so a run that created the task can close', async () => {
    const item = await kit.bot.createItem({ channelId: kit.main.id, title: 'Weekly recap', owner: 'user' });
    const plan = await kit.bot.deleteRecord(item.id, true);
    kit.schedules.changed = [];
    await kit.bot.deleteRecord(item.id, false, { files: plan.files });
    expect(kit.schedules.changed.map((c) => c.id)).toEqual([item.id]);
  });

  it('BOT-EX-20 the files a thread writes and the file outputs it reports are recorded for the task', async () => {
    const dir = kit.bot.filesDir(kit.main.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'before.txt'), 'already here');
    kit.thread = firstTurn(async (ctx) => {
      await fs.mkdir(path.join(dir, 'out'), { recursive: true });
      await fs.writeFile(path.join(dir, 'out', 'captions.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHi');
      await fs.writeFile(path.join(dir, 'report.md'), 'summary');
      await ctx.call('thread_report', {
        stop: 'needs-review',
        headline: 'Captions are ready.',
        outputs: [{ kind: 'file', path: 'report.md', label: 'Summary', version: null }],
      });
    });
    const item = await kit.startTask('Caption the intro');
    await kit.until(() => kit.item(item.id).files.length === 2);
    expect([...kit.item(item.id).files].sort()).toEqual([path.join('out', 'captions.srt'), 'report.md']);
    const plan = await kit.bot.deleteRecord(item.id, true);
    expect([...plan.files].sort()).toEqual([path.join('out', 'captions.srt'), 'report.md']);
    await kit.bot.deleteRecord(item.id, false, { files: plan.files });
    await expect(fs.access(path.join(dir, 'report.md'))).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, 'before.txt'), 'utf8')).toBe('already here');
  });

  it('BOT-EX-20 when two threads write in the channel folder at the same time, only what each reports is recorded', async () => {
    const dir = kit.bot.filesDir(kit.main.id);
    await fs.mkdir(dir, { recursive: true });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let bWrote = false;
    kit.thread = firstTurn(async (ctx) => {
      if (kit.bot.itemOfThread(ctx.conversationId)?.title === 'Cut A') {
        await fs.writeFile(path.join(dir, 'a.txt'), 'a');
        await gate;
        await ctx.call('thread_report', { stop: 'needs-review', headline: 'A is done.', outputs: [{ kind: 'file', path: 'a.txt', label: 'A', version: null }] });
      } else {
        await fs.writeFile(path.join(dir, 'b.txt'), 'b');
        bWrote = true;
        await gate;
        await ctx.call('thread_report', { stop: 'needs-review', headline: 'B is done.' });
      }
    });
    const a = await kit.bot.createItem({ channelId: kit.main.id, title: 'Cut A', owner: 'agent' });
    const b = await kit.bot.createItem({ channelId: kit.main.id, title: 'Cut B', owner: 'agent' });
    await kit.bot.startItem(a.id, { attended: false });
    await kit.bot.startItem(b.id, { attended: false });
    await kit.until(() => bWrote);
    release();
    await kit.until(() => stateName(kit.item(a.id)) === 'needsReview' && stateName(kit.item(b.id)) === 'needsReview');
    await kit.settle();
    // b.txt 是 B 写的，A 的回合与它重叠：不能记在 A 名下；B 没报告它，也不按快照猜。
    expect(kit.item(a.id).files).toEqual(['a.txt']);
    expect(kit.item(b.id).files).toEqual([]);
    expect((await kit.bot.deleteRecord(a.id, true)).files).toEqual(['a.txt']);
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

describe('stopping from the thread itself', () => {
  it('a turn stopped from the thread composer stops the task too: it frees its slot and offers Continue', async () => {
    let release: () => void = () => {};
    kit.thread = () => new Promise<void>((resolve) => (release = resolve));
    const item = await kit.bot.createItem({ channelId: kit.main.id, title: 'Voice the intro', owner: 'agent' });
    await kit.bot.startItem(item.id, { attended: true });
    await kit.until(() => kit.item(item.id).threadId && kit.harness.conversationOf(kit.threadOf(item.id))?.activity === 'running');
    expect(kit.item(item.id).active?.state).toBe('working');
    const thread = kit.harness.conversationOf(kit.threadOf(item.id))!;
    await kit.harness.stopTask(thread.activeTaskId!);
    release();
    await kit.until(() => kit.item(item.id).active?.state === 'blocked');
    expect(kit.item(item.id).question?.options.map((o) => o.label).length).toBeGreaterThan(0);
    expect(kit.item(item.id).active?.reason).toBe(RcBot.stoppedByYou().text);
    expect(kit.bot.status().workingThreads).toEqual([]);
    await kit.settle();
  });
});

describe('undo baselines', () => {
  it('after a thread turn, the version before its first change of each video is kept on the task, and a later turn does not move it', async () => {
    const video = { kind: 'video', projectId: 'proj_1', videoId: 'video_0123456789abcdef' } as const;
    kit.workspace.baselineFinds = [{ projectId: 'proj_1', videoId: video.videoId, version: 4 }];
    const item = await kit.startTask('Trim episode 4', { resources: [video] });
    await kit.until(() => kit.item(item.id).baseVersions.length === 1);
    expect(kit.item(item.id).baseVersions).toEqual([{ projectId: 'proj_1', videoId: video.videoId, version: 4 }]);

    kit.workspace.baselineFinds = [{ projectId: 'proj_1', videoId: video.videoId, version: 9 }];
    await kit.send(kit.threadOf(item.id), 'Trim a bit more');
    await kit.settle();
    expect(kit.item(item.id).baseVersions).toEqual([{ projectId: 'proj_1', videoId: video.videoId, version: 4 }]);
  });
});

describe('stopping the service', () => {
  it('stop waits for background writes that are still running, so nothing is written after it returns', async () => {
    const video = { kind: 'video', projectId: 'proj_1', videoId: 'video_0123456789abcdef' } as const;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let asked = false;
    // 回合结束后读视频基线（没人等着的后台处理）：读得很慢。
    kit.workspace.baselines = async () => {
      asked = true;
      await gate;
      return [{ projectId: 'proj_1', videoId: video.videoId, version: 4 }];
    };
    const item = await kit.startTask('Trim episode 4', { resources: [video] });
    await kit.until(() => asked);
    let stopped = false;
    const stopping = kit.bot.stop().then(() => (stopped = true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stopped).toBe(false);
    release();
    await stopping;
    // stop 返回时基线已经写进任务存储。
    const store = new WorkItemStore(kit.home.workItemsDir);
    const saved = (await store.load(kit.main.id)).items.find((i) => i.id === item.id);
    expect(saved?.baseVersions).toEqual([{ projectId: 'proj_1', videoId: video.videoId, version: 4 }]);
  });
});

describe('queued tasks across a restart', () => {
  it('a queued task keeps its brief and file ownership when the runtime restarts before it starts', async () => {
    const first = await kit.startTask('Color grade episode 7');
    const second = await kit.coordinatorTurn('Also add captions to episode 7', (ctx) =>
      ctx.call<{ workItemId: Id; queued: boolean }>('thread_start', {
        create: { title: 'Add captions to episode 7', sourceMessageId: userMessageIn(ctx), dependsOn: [first.id] },
        citedMessageIds: [userMessageIn(ctx)],
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
