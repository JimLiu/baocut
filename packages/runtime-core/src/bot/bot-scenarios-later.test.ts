import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Id, TimelineItem } from '@baocut/protocol';
import { RcBot } from '@baocut/protocol/messages/runtime-core';
import { botMethods } from './bot-methods.ts';
import { formatLocal, localDay } from './context-blocks.ts';
import { coordinatorInstructions, threadInstructions } from './instructions.ts';
import { stateName } from './work-item-machine.ts';
import { BotKit, escalate, type TurnContext } from './testing/bot-kit.ts';

/* Bot 的使用场景 BOT-S17–S31（需求 §9）在服务与工具层能看到的部分。界面、托盘与系统通知的部分在 UI 与桌面端的测试里。 */

let kit: BotKit;
beforeEach(async () => {
  kit = await BotKit.open();
});
afterEach(async () => {
  await kit.close();
});

const main = () => kit.main.conversationId;
const userMsg = (ctx: TurnContext) => kit.bot.runOf(ctx.conversationId)!.userMessageId!;
const state = (id: Id) => stateName(kit.item(id));
const ofKind = <K extends TimelineItem['kind']>(conversationId: Id, kind: K) =>
  kit.items(conversationId).filter((i): i is Extract<TimelineItem, { kind: K }> => i.kind === kind);
const byTitle = (prefix: string, fn: (ctx: TurnContext) => unknown) => {
  const seen = new Set<Id>();
  return async (ctx: TurnContext) => {
    const item = kit.bot.itemOfThread(ctx.conversationId);
    if (!item?.title.startsWith(prefix) || seen.has(ctx.conversationId)) return;
    seen.add(ctx.conversationId);
    await fn(ctx);
  };
};
/** 不经 settle 地让协调者开一个线程（线程回合会一直停着时用）。 */
async function startHeld(title: string): Promise<Id> {
  kit.coordinator = async (ctx) => {
    if (kit.bot.runOf(ctx.conversationId)?.origin !== 'user') return;
    await ctx.call('thread_start', { create: { title, sourceMessageId: userMsg(ctx) }, citedMessageIds: [userMsg(ctx)] });
  };
  await kit.send(main(), title);
  const id = await kit.until(() => kit.bot.listItems(kit.main.id).find((i) => i.title === title)?.id);
  kit.coordinator = () => {};
  return id;
}

describe('BOT-S17..S31', () => {
  it('BOT-S17 "anything I need to handle?" lists only what is still open: handled work drops out, stopped work is included', async () => {
    kit.thread = byTitle('Fix', (ctx) => ctx.call('thread_report', { stop: 'blocked', headline: 'The source file is missing.', question: { text: 'Upload the source again?', options: [] } }));
    const handled = await kit.startTask('Export episode 1');
    const waiting = await kit.startTask('Export episode 2');
    const stuck = await kit.startTask('Fix the audio of episode 3');
    expect(state(stuck.id)).toBe('blocked');
    // 用户自己在界面上处理了第一件。
    await kit.bot.userTransition(handled.id, { type: 'resolve', evidence: null });
    // 「等你」收件箱只列待审阅与需要你（BOT-CH-11，与徽标同一批）；停下的在频道的任务列表里，协调者照样看得到。
    const rows = kit.bot.inbox();
    expect(rows.map((r) => [r.workItemId, r.state])).toEqual([[waiting.id, 'needsReview']]);
    const text = await kit.coordinatorTurn('Anything I need to handle?', (ctx) => ctx.turn.text);
    expect(text).toContain(`- ${waiting.id} [needsReview] Export episode 2`);
    expect(text).toContain(`- ${stuck.id} [blocked] Fix the audio of episode 3 | The source file is missing. | asks: Upload the source again?`);
    expect(text).not.toContain(handled.id);
  });

  it('BOT-S18 a refresh finds the user already exported: the thread closes with verified evidence, reports once, and the user can reopen', async () => {
    const item = await kit.startTask('Export the final cut of episode 3');
    expect(state(item.id)).toBe('needsReview');
    const evidence = { kind: 'export' as const, projectId: 'proj_1', videoId: 'vid_1', exportId: 'exp_1' };
    kit.workspace.evidenceProblems.set('export', 'No such export.');
    let out: Record<string, unknown> | null = null;
    kit.thread = async (ctx) => {
      if (out || kit.bot.runOf(ctx.conversationId)?.origin !== 'refresh') return;
      const rejected = await ctx.tryCall('work_items_update', { event: { type: 'resolve', evidence: [evidence] } });
      kit.workspace.evidenceProblems.delete('export');
      out = {
        rejected,
        resolved: await ctx.tryCall('work_items_update', { update: 'Saw the final cut was already exported', event: { type: 'resolve', evidence: [evidence] } }),
        report: await ctx.tryCall('thread_report', { stop: 'done', headline: 'You already exported the final cut.' }),
      };
    };
    expect(await kit.bot.refreshItem(item.id)).not.toBe('dropped');
    await kit.until(() => out);
    await kit.settle();
    expect(out!.rejected).toMatchObject({ ok: false, error: { code: 'EVIDENCE_REJECTED' } });
    expect(out!.resolved).toMatchObject({ ok: true, result: { item: { state: 'done' } } });
    expect(out!.report).toMatchObject({ ok: true });
    expect(kit.item(item.id)).toMatchObject({ status: 'resolved', resolution: { kind: 'done', by: 'thread', evidence: [evidence] } });
    expect(kit.item(item.id).updates.map((u) => u.text)).toContain('Saw the final cut was already exported');
    expect(kit.turns(main()).at(-1)).toContain('headline: You already exported the final cut.');
    await kit.bot.userTransition(item.id, { type: 'reopen' });
    expect(kit.item(item.id)).toMatchObject({ status: 'active', active: { state: 'working' } });
  });

  it('BOT-S19 back in the evening: the away summary counts done, waiting and stopped work since the last visit (banner covered in UI tests)', async () => {
    kit.thread = byTitle('Fix', (ctx) => ctx.call('thread_report', { stop: 'blocked', headline: 'The font is missing.' }));
    await kit.startTask('Old task before leaving');
    await kit.bot.markSeen(kit.main.id, null);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const done = await kit.startTask('Make chapters for episode 4');
    await kit.bot.userTransition(done.id, { type: 'resolve', evidence: null });
    const waiting = await kit.startTask('Pick a thumbnail for episode 4');
    const stopped = await kit.startTask('Fix the title font');
    const summary = kit.bot.awaySummary(kit.main.id);
    expect(summary.since).toBeTruthy();
    expect(summary.done.map((r) => r.id)).toEqual([done.id]);
    expect(summary.needsYou.map((r) => r.id)).toEqual([waiting.id]);
    expect(summary.stopped).toEqual([{ id: stopped.id, title: 'Fix the title font', headline: 'The font is missing.' }]);
    expect(summary.firstUnreadItemId).toBeTruthy();
  });

  it('BOT-S20 something cannot be found: the agent says where it looked and offers close candidates to tap', async () => {
    expect(coordinatorInstructions(kit.main)).toContain('When you cannot find something, say where and how you looked. If the user insists it exists, search again with different words.');
    const out = await kit.coordinatorTurn("Add captions to last week's episode", async (ctx) => {
      ctx.turn.say('I looked in your three projects by date and found no episode from last week. Did you mean one of these?');
      return ctx.tryCall('suggest_replies', {
        chips: [
          { label: 'Episode 11', kind: 'answer' },
          { label: 'Episode 12', kind: 'answer' },
          { label: 'Other', kind: 'other' },
        ],
      });
    });
    expect(out).toMatchObject({ ok: true, result: { attached: 3 } });
    expect(ofKind(main(), 'suggestions').at(-1)!.chips.map((c) => [c.kind, c.text])).toEqual([
      ['answer', 'Episode 11'],
      ['answer', 'Episode 12'],
      ['other', ''],
    ]);
  });

  it('BOT-S21 "change it back": the thread works out the version before its own changes, restores it with the video tool and says so; the user can close it', async () => {
    const item = await kit.startTask('Restyle the captions of episode 2');
    const out = await kit.threadTurn(item.id, 'Change it back, the original was better', async (ctx) => {
      const reverted = await ctx.call<{ restore: unknown; note: string }>('work_items_revert', { to: 'before-thread' });
      await ctx.call('thread_report', { stop: 'needs-review', headline: 'The captions are back to how they were.' });
      return reverted;
    });
    // 这个工具自己不恢复：给出 videos_restore_version 的参数，恢复照样过视频工具的授权、确认与保护范围。
    expect(out).toEqual({ restore: [{ video: 'vid_1', version: 3, before: true }], note: expect.stringContaining('videos_restore_version') });
    expect(kit.workspace.threadReverts).toEqual([{ item: item.id, to: 'before-thread' }]);
    // 报告在回合结束后才落到任务上：机器忙时可能晚一点，等它而不是立刻看。
    await kit.until(() => state(item.id) === 'needsReview');
    await kit.settle();
    await kit.bot.userTransition(item.id, { type: 'resolve', evidence: null });
    expect(kit.item(item.id).status).toBe('resolved');
  });

  it('BOT-S22 BOT-SF-12 a yes to one paid segment does not cover two: the bigger step asks again', async () => {
    let thread: TurnContext | null = null;
    kit.thread = byTitle('Voice', (ctx) => {
      thread = ctx;
      escalate(ctx, 'voice-generate --segment 3 (about 12 CNY)');
    });
    const id = await startHeld('Voice-over for segment 3');
    await kit.until(() => state(id) === 'needsInput');
    const first = kit.bot.inbox()[0]!.approval!;
    expect(first.summary).toContain('segment 3');
    await kit.harness.respondToApproval({ conversationId: kit.threadOf(id), approvalId: first.approvalId, decision: 'accept' });
    await kit.until(() => state(id) === 'working');
    const second = escalate(thread!, 'voice-generate --segments 3,4 (about 25 CNY)');
    await kit.until(() => state(id) === 'needsInput');
    expect(kit.harness.approvals.pending().map((p) => p.approvalId)).toEqual([second]);
    expect(kit.item(id).question?.approvalId).toBe(second);
    expect(ofKind(kit.threadOf(id), 'approval').map((a) => a.status)).toEqual(['accepted', 'pending']);
  });

  it('BOT-S23 after a time zone change the channel state shows times in the new zone (schedule display covered in schedule and UI tests)', async () => {
    await kit.bot.updateSettings({ timeZone: 'Asia/Tokyo' });
    const text = await kit.coordinatorTurn('What day is it for you?', (ctx) => ctx.turn.text);
    const local = formatLocal(new Date(kit.clock.now()), 'Asia/Tokyo');
    expect(text).toContain(`now: ${local.slice(0, 10)}`);
    expect(text).toContain('(Asia/Tokyo)');
    // 用户的任务按新时区的「明天」提醒。
    const tomorrow = localDay(new Date(kit.clock.now() + 86_400_000), 'Asia/Tokyo');
    const mine = await kit.bot.createItem({ channelId: kit.main.id, title: 'Send the invoice', owner: 'user', dueOn: tomorrow });
    await kit.bot.hourly();
    expect(kit.item(mine.id).reminded).toContain(`due:${tomorrow}`);
  });

  it('BOT-S24 "just add captions from now on" is kept as the user rule, but publishing still asks', async () => {
    await kit.coordinatorTurn('From now on just add captions, no need to ask me', (ctx) =>
      ctx.call('channel_write_memory', { content: '## Rules\n- Add captions without asking (2026-10-31).\n', ifVersion: 0 }),
    );
    kit.thread = byTitle('Caption', (ctx) => escalate(ctx, 'publish-video --platform external'));
    const item = await kit.startTask('Caption episode 9 and publish it');
    expect(kit.turns(kit.threadOf(item.id))[0]).toContain('channel rules:\n- Add captions without asking (2026-10-31).');
    await kit.until(() => state(item.id) === 'needsInput');
    expect(kit.harness.approvals.pending()).toHaveLength(1);
    const chip = await kit.coordinatorTurn('ok', async (ctx) => {
      ctx.turn.say('Publish it?');
      return ctx.tryCall('suggest_replies', { chips: [{ label: 'Yes, always', kind: 'answer' }] });
    });
    expect(chip).toMatchObject({ ok: false, error: { code: 'INVALID_SUGGESTIONS' } });
  });

  it('BOT-S25 small details get a default instead of a question (instruction level)', () => {
    for (const text of [coordinatorInstructions(kit.main), threadInstructions(kit.main, undefined, 'notes.md')]) {
      expect(text).toContain('For small details the user can change in a word, pick a sensible default and say which.');
      expect(text).toContain('Ask only when a wrong guess would change the result');
    }
  });

  it('BOT-S26 seven things waiting in three channels: the inbox lists each with its own approval, nothing approves them all (inbox screen covered in UI tests)', async () => {
    const podcast = await kit.bot.createChannel({ name: 'Podcast' });
    const shorts = await kit.bot.createChannel({ name: 'Shorts' });
    kit.thread = byTitle('Paid', (ctx) => escalate(ctx, 'paid-generate'));
    const paidA = await kit.startTask('Paid voice for episode 1');
    const paidB = await kit.startTask('Paid music for episode 2');
    await kit.bot.createItem({ channelId: podcast.id, title: 'Edit podcast 4', owner: 'agent' }, { start: true, attended: false });
    await kit.bot.createItem({ channelId: shorts.id, title: 'Cut shorts from episode 5', owner: 'agent' }, { start: true, attended: false });
    await kit.until(() => kit.bot.inbox().length === 4);
    await kit.settle();
    const rows = kit.bot.inbox();
    expect(new Set(rows.map((r) => r.channelId))).toEqual(new Set([kit.main.id, podcast.id, shorts.id]));
    const paid = rows.filter((r) => r.approval);
    expect(paid.map((r) => r.workItemId).sort()).toEqual([paidA.id, paidB.id].sort());
    expect(new Set(paid.map((r) => r.approval!.approvalId)).size).toBe(2);
    expect(kit.bot.status().needsYou).toBe(4);
    expect(Object.keys(botMethods(() => null)).filter((m) => /approv|accept|\.all/i.test(m))).toEqual([]);
  });

  it('BOT-S27 asked in Chinese for English subtitles: the conversation stays Chinese, the output contract says English', async () => {
    await kit.bot.updateChannel(kit.main.id, { outputLanguage: 'en' });
    const request = '给这期出英文字幕';
    const item = await kit.startTask(request);
    expect(kit.item(item.id).title).toBe(request);
    expect(kit.turns(kit.threadOf(item.id))[0]).toContain('<baocut-task-contract outputLanguage="en"/>');
    const text = await kit.coordinatorTurn('进度怎么样了？', (ctx) => ctx.turn.text);
    expect(text).toContain('conversation language: zh');
    expect(coordinatorInstructions(kit.main)).toContain("Use the language of the user's latest messages for everything the user reads.");
  });

  it('a task the coordinator only created, started later by the user, still hands the thread the original request', async () => {
    const created = await kit.coordinatorTurn('Cut the intro to five seconds and keep the logo on screen', (ctx) =>
      ctx.call<{ id: Id }>('work_items_create', { title: 'Cut the intro', sourceMessageId: userMsg(ctx) }),
    );
    kit.thread = () => {};
    await kit.bot.startItem(created.id, { attended: true });
    await kit.settle();
    const brief = kit.turns(kit.threadOf(created.id))[0]!;
    expect(brief).toContain('Cut the intro to five seconds and keep the logo on screen');
    expect(brief).toContain('<baocut-cited author="user"');
  });

  it('a thread that keeps editing videos without updating its task is not taken for stalled', async () => {
    kit.thread = byTitle('Render', (ctx) => ctx.turn.hold());
    const id = await startHeld('Render the long cut');
    await kit.until(() => {
      const threadId = kit.item(id).threadId;
      return state(id) === 'working' && !!threadId && kit.harness.conversationOf(threadId)?.activity === 'running';
    });
    const thread = kit.threadOf(id);
    const edit = (n: number) =>
      kit.harness.recordVideoChange(thread, kit.harness.conversationOf(thread)!.activeTaskId, {
        videoId: 'v1',
        videoName: 'cut',
        target: { conversationId: thread, path: 'cut' },
        transactionId: `tx${n}`,
        label: 'Trim',
        previousRevision: `r${n}`,
        videoRevision: `r${n + 1}`,
        createdIds: [],
        updatedIds: [],
        deletedIds: [],
        durationSeconds: { before: 10, after: 9 },
      } as never);
    kit.clock.offset = 10 * 60_000;
    await kit.bot.watchdog();
    edit(1);
    kit.clock.offset = 21 * 60_000;
    await kit.bot.watchdog();
    expect(state(id)).toBe('working');
    expect(kit.clock.now() - Date.parse(kit.item(id).lastProgressAt!)).toBeLessThan(60_000);
    // 之后真的没动静了，照样按 20 分钟判卡住。
    kit.clock.offset = 42 * 60_000;
    await kit.bot.watchdog();
    expect(kit.item(id).active).toMatchObject({ state: 'blocked', reason: RcBot.stalledNoProgress({ minutes: 20 }).text });
  });

  it('BOT-S28 no progress for 20 minutes: the task stops itself, and "continue" tells the thread to read its notes and try another way', async () => {
    kit.thread = byTitle('Render', (ctx) => ctx.turn.hold());
    const id = await startHeld('Render all chapters');
    await kit.until(() => {
      const threadId = kit.item(id).threadId;
      return state(id) === 'working' && !!threadId && kit.harness.conversationOf(threadId)?.activity === 'running';
    });
    kit.clock.offset = 19 * 60_000;
    await kit.bot.watchdog();
    expect(state(id)).toBe('working');
    kit.clock.offset = 21 * 60_000;
    await kit.bot.watchdog();
    expect(kit.item(id)).toMatchObject({ active: { state: 'blocked', reason: RcBot.stalledNoProgress({ minutes: 20 }).text }, question: { askedBy: 'system' } });
    expect(kit.notifications().some((n) => n.reason === 'stalled' && n.workItemId === id)).toBe(true);
    await kit.settle();
    kit.thread = () => {};
    await kit.bot.userTransition(id, { type: 'unblocked', cause: 'user' });
    await kit.settle();
    const text = kit.turns(kit.threadOf(id)).at(-1)!;
    expect(text).toContain('<baocut-refresh reason="stalled">');
    expect(text).toContain('Read your working notes first. If the last approach got stuck, try a different one.');
  });

  it('BOT-S29 "revert everything" lists the user own edits first and keeps or reverts them as chosen (menu covered in UI tests)', async () => {
    const item = await kit.startTask('Restyle the captions of episode 2');
    kit.workspace.plan = {
      videos: [{ projectId: 'proj_1', videoId: 'vid_1', baseVersion: 3, userEdits: [{ version: 5, at: '2026-10-31T10:00:00.000Z' }], agentOnlyPossible: false, reason: null }],
    };
    expect(await kit.bot.revertAll(item.id, true, false)).toEqual({ plan: kit.workspace.plan });
    await expect(kit.bot.revertAll(item.id, false, true)).rejects.toMatchObject({ code: 'conflict', details: { videoId: 'vid_1' } });
    expect(kit.workspace.reverts).toEqual([]);
    expect(await kit.bot.revertAll(item.id, false, false)).toEqual({ restored: [{ videoId: 'vid_1', version: 3 }] });
    expect(kit.workspace.reverts).toEqual([{ item: item.id, keepUserEdits: false }]);
  });

  it('BOT-S30 the user edits "cut 3" to "cut 5": the thread gets both versions marked as edited', async () => {
    const item = await kit.startTask('Cut 3 clips from episode 6');
    const messageId = kit.item(item.id).source.messageId!;
    await kit.bot.editMessage(main(), messageId, 'Cut 5 clips from episode 6');
    await kit.settle();
    const text = kit.turns(kit.threadOf(item.id)).at(-1)!;
    expect(text).toContain(`<baocut-relay task="${item.id}" kind="edited">`);
    expect(text).toMatch(new RegExp(`<baocut-cited author="user" via="typed" id="${messageId}@0"[^>]*>\\nCut 3 clips from episode 6\\n</baocut-cited>`));
    expect(text).toMatch(new RegExp(`<baocut-cited author="user" via="typed" id="${messageId}"[^>]*>\\nCut 5 clips from episode 6\\n</baocut-cited>`));
    // 改过的话让任务回到工作中，线程接着报告，频道里之后还有回合：只看协调者收到过改动。
    expect(kit.turns(main()).some((t) => t.includes('kind="edited"'))).toBe(true);
    expect(ofKind(main(), 'user-message').find((m) => m.id === messageId)).toMatchObject({ text: 'Cut 5 clips from episode 6', revision: 1, history: [{ text: 'Cut 3 clips from episode 6' }] });
  });

  it('BOT-S31 the report says which earlier rule it followed, and the coordinator is told to say so', async () => {
    await kit.coordinatorTurn('Captions in white from now on', (ctx) => ctx.call('channel_write_memory', { content: '## Rules\n- Captions in white (2026-10-31).\n', ifVersion: 0 }));
    kit.thread = byTitle('Add', (ctx) =>
      ctx.call('thread_report', { stop: 'needs-review', headline: 'Captions are added.', appliedRules: ['Captions in white (2026-10-31)'] }),
    );
    await kit.startTask('Add captions to episode 12');
    expect(kit.turns(main()).at(-1)).toContain('followed rule: Captions in white (2026-10-31)');
    const instructions = coordinatorInstructions(kit.main);
    expect(instructions).toContain('When a report lists a followed rule');
    expect(instructions).toContain('ask once whether it is for this time only or from now on');
  });
});
