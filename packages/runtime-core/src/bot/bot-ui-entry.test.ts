import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Id, TimelineItem } from '@baocut/protocol';
import { RcBot } from '@baocut/protocol/messages/runtime-core';
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
