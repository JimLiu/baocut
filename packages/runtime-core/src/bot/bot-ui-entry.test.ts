import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Id, TimelineItem } from '@baocut/protocol';
import { RcBot } from '@baocut/protocol/messages/runtime-core';
import type { TrustedPrincipal } from '../gateway.ts';
import { botMethods } from './bot-methods.ts';
import { BotKit } from './testing/bot-kit.ts';

/* 界面入口要的 Runtime 部分（需求 §11）：设置里的 Make 自动触发与补充提示开关。 */

let kit: BotKit;
beforeEach(async () => {
  kit = await BotKit.open();
});
afterEach(async () => {
  await kit.close();
});

const main = () => kit.main.conversationId;
/** 提示条目，不算主频道第一条消息下的起手提示。 */
const suggestions = (conversationId: Id) =>
  kit
    .items(conversationId)
    .filter((i): i is Extract<TimelineItem, { kind: 'suggestions' }> => i.kind === 'suggestions' && !i.chips.some((c) => c.kind === 'starter'));

describe('设置里的 Make 自动触发与补充提示（需求 §11.8）', () => {
  it('两个开关默认开着，存下来再读回', async () => {
    expect(kit.bot.settings()).toMatchObject({ makeAutoTrigger: true, supplementHints: true });
    await kit.bot.updateSettings({ makeAutoTrigger: false, supplementHints: false });
    await kit.restart();
    expect(kit.bot.settings()).toMatchObject({ makeAutoTrigger: false, supplementHints: false });
  });

  it('关掉自动触发后自动的 Make 不跑，手动的照跑', async () => {
    kit.make.candidates = [{ title: 'Add captions to episode 12', reason: 'It has none yet', kindTag: 'add-captions', evidence: [] }];
    await kit.bot.updateSettings({ makeAutoTrigger: false });
    expect(await kit.bot.runMake(kit.main.id, 'item-resolved')).toMatchObject({ shown: 0 });
    expect(kit.make.inputs).toHaveLength(0);
    await kit.bot.runMake(kit.main.id, 'manual');
    expect(kit.make.inputs).toHaveLength(1);
  });

  it('智能体没给提示、最后一句是「要我……吗」：回合结束时补上「好」「不」；关掉开关就不补', async () => {
    await kit.coordinatorTurn('Episode 12 has no captions', (ctx) => ctx.turn.say('Episode 12 has no captions yet. Shall I add them?'));
    const [group] = suggestions(main());
    expect(group).toMatchObject({ source: 'system', state: 'open' });
    expect(group!.chips.map((c) => [c.kind, c.text, c.recommended])).toEqual([
      ['confirm', RcBot.reactionYes().text, false],
      ['decline', RcBot.reactionNo().text, false],
    ]);

    await kit.bot.updateSettings({ supplementHints: false });
    await kit.coordinatorTurn('And episode 13?', (ctx) => ctx.turn.say('Episode 13 has none either. Shall I add them too?'));
    expect(suggestions(main()).filter((g) => g.state === 'open')).toEqual([]);
  });

  it('智能体自己给了提示、或不是确认问句时不补', async () => {
    await kit.coordinatorTurn('Which style?', async (ctx) => {
      ctx.turn.say('Which caption style do you want, white or yellow?');
      await ctx.call('suggest_replies', { chips: [{ label: 'White', text: 'White captions', kind: 'answer' }, { label: 'Yellow', text: 'Yellow captions', kind: 'answer' }] });
    });
    expect(suggestions(main()).map((g) => g.source)).toEqual(['agent']);
    await kit.coordinatorTurn('Thanks', (ctx) => ctx.turn.say('You are welcome.'));
    expect(suggestions(main()).map((g) => g.source)).toEqual(['agent']);
  });
});

describe('截止日与事件日是谁定的（BOT-TK-06）', () => {
  const desktop: TrustedPrincipal = { kind: 'desktop', connectionId: 'ui', name: 'desktop' };
  const rpc = <T>(name: string, params: unknown) =>
    (botMethods(() => kit.bot)[name as 'workItems.update'] as unknown as (p: unknown, pr: TrustedPrincipal) => Promise<T>)(params, desktop);

  it('界面里新建或改的记成你定的；智能体按你的消息写的记成来自消息；清掉日期一起清掉', async () => {
    const { item: mine } = await rpc<{ item: { id: Id } }>('workItems.create', { channelId: kit.main.id, title: 'Record the intro', owner: 'user', dueOn: '2026-11-07' });
    expect(kit.bot.item(mine.id)).toMatchObject({ dueOn: '2026-11-07', dueOnBy: 'user' });

    const { id } = await kit.startTask('Add captions to episode 12');
    await kit.coordinatorTurn('Need it by Friday', async (ctx) => {
      await ctx.call('work_items_update', { id, dueOn: '2026-11-06' });
      ctx.turn.say('Due Friday.');
    });
    expect(kit.bot.item(id)).toMatchObject({ dueOn: '2026-11-06', dueOnBy: 'agent' });

    await rpc('workItems.update', { id, patch: { dueOn: '2026-11-08', priority: 'high' } });
    expect(kit.bot.item(id)).toMatchObject({ dueOn: '2026-11-08', dueOnBy: 'user', priority: 'high' });
    // 只改优先级、日期没动：仍是你定的。
    await kit.coordinatorTurn('Make it low priority', async (ctx) => {
      await ctx.call('work_items_update', { id, priority: 'low' });
      ctx.turn.say('Done.');
    });
    expect(kit.bot.item(id)).toMatchObject({ dueOnBy: 'user', priority: 'low' });

    await rpc('workItems.update', { id, patch: { dueOn: null } });
    expect(kit.bot.item(id).dueOn).toBeNull();
    expect(kit.bot.item(id).dueOnBy).toBeUndefined();
  });
});

describe('导出频道（BOT-CH-13）', () => {
  it('tasks.json 带上任务的状态转换记录', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'bot-export-'));
    try {
      const item = await kit.startTask('Add captions to episode 12');
      const target = await kit.bot.exportChannel(kit.main.id, dir);
      const tasks = JSON.parse(await readFile(path.join(target, 'tasks.json'), 'utf8')) as { transitions: { workItemId: Id; to: unknown }[] };
      expect(tasks.transitions.length).toBeGreaterThan(0);
      expect(tasks.transitions.every((t) => t.workItemId === item.id)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
