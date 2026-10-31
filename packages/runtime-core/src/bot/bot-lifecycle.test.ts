import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BotKit } from './testing/bot-kit.ts';

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
});
