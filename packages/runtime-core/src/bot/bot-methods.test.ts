import { afterEach, describe, expect, it } from 'vitest';
import { newId, RpcError, type Id, type TimelineItem } from '@baocut/protocol';
import type { TrustedPrincipal } from '../gateway.ts';
import { botMethods, wrapBotSend, wrapBotSteer } from './bot-methods.ts';
import { BotKit } from './testing/bot-kit.ts';

/** Bot 的方法表（技术方案 §16.1）：只给用户本人；没有 Bot 时 unsupported；发送包装里答案提示直接回答提问卡（§12.4）。 */

const desktop: TrustedPrincipal = { kind: 'desktop', connectionId: 'ui', name: 'desktop' };
const agent = { kind: 'agent', connectionId: 'a', name: 'agent', conversationId: 'conv_x' } as TrustedPrincipal;
const service: TrustedPrincipal = { kind: 'service', connectionId: 's', name: 'svc' };

async function codeOf(fn: () => unknown): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return error instanceof RpcError ? error.code : `not-rpc: ${String(error)}`;
  }
}

describe('botMethods principals', () => {
  const methods = botMethods(() => ({}) as never);
  const names = Object.keys(methods) as (keyof typeof methods)[];

  it.each(names)('%s is forbidden for agents and services', async (name) => {
    const handler = methods[name] as (p: unknown, pr: TrustedPrincipal) => unknown;
    expect(await codeOf(() => handler({ patch: {} }, agent))).toBe('forbidden');
    expect(await codeOf(() => handler({ patch: {} }, service))).toBe('forbidden');
  });

  it.each(names)('%s is unsupported with no bot', async (name) => {
    const handler = botMethods(() => null)[name] as (p: unknown, pr: TrustedPrincipal) => unknown;
    expect(await codeOf(() => handler({ patch: {} }, desktop))).toBe('unsupported');
  });
});

describe('wrapBotSend outside bot conversations', () => {
  it('drops via, chip and reply target before a plain chat send', async () => {
    const seen: unknown[] = [];
    const harness = { conversationOf: () => ({ role: 'chat' }) } as never;
    const send = wrapBotSend(() => ({}) as never, harness, ((p: unknown) => {
      seen.push(p);
      return { taskId: 'task_1' };
    }) as never);
    await send({ conversationId: 'c', text: 'hi', commandId: 'cmd_1', via: 'suggestion', suggestionChipId: 'chip_1', replyToItemId: 'x' } as never, desktop);
    await send({ conversationId: 'c', text: 'hi', commandId: 'cmd_2' } as never, desktop);
    expect(seen).toEqual([
      { conversationId: 'c', text: 'hi', commandId: 'cmd_1' },
      { conversationId: 'c', text: 'hi', commandId: 'cmd_2' },
    ]);
  });

  it('without a bot every conversation is passed through', async () => {
    const seen: unknown[] = [];
    const send = wrapBotSend(() => null, { conversationOf: () => ({ role: 'channel' }) } as never, ((p: unknown) => {
      seen.push(p);
      return { taskId: 't' };
    }) as never);
    await send({ conversationId: 'c', text: 'x', commandId: 'cmd', via: 'typed' } as never, desktop);
    expect(seen).toEqual([{ conversationId: 'c', text: 'x', commandId: 'cmd' }]);
  });
});

describe('wrapBotSend in a channel', () => {
  let kit: BotKit;
  afterEach(async () => {
    await kit?.close();
  });

  const suggestions = (conversationId: Id) =>
    kit.items(conversationId).filter((i): i is Extract<TimelineItem, { kind: 'suggestions' }> => i.kind === 'suggestions');

  /** 协调者在回合里提一个单选问题（Driver 的提问卡），回合停着等回答。 */
  async function askQuestion(): Promise<{ approvalId: Id; finish: () => void }> {
    const approvalId = newId('ap');
    let finish: () => void = () => {};
    let asked = false;
    kit.coordinator = (ctx) => {
      if (asked) return;
      asked = true;
      ctx.turn.hold();
      finish = () => ctx.turn.complete();
      ctx.turn.session.emit({
        type: 'approval.requested',
        turnId: ctx.turn.session.turnId!,
        approvalId,
        request: {
          kind: 'question',
          reason: null,
          rule: null,
          questions: [
            {
              id: 'q1',
              header: 'Format',
              question: 'Which aspect ratio?',
              options: [
                { label: '16:9', description: '' },
                { label: '9:16', description: '' },
              ],
              multiSelect: false,
              allowOther: false,
            },
          ],
        },
      } as never);
    };
    await kit.send(kit.main.conversationId, 'make a short');
    await kit.until(() => suggestions(kit.main.conversationId).some((s) => s.source === 'question'));
    return { approvalId, finish: () => finish() };
  }

  it('an answer chip answers the question card and writes a via-suggestion message without a new turn', async () => {
    kit = await BotKit.open();
    const { approvalId, finish } = await askQuestion();
    const sug = suggestions(kit.main.conversationId).find((s) => s.source === 'question')!;
    expect(sug.chips.map((c) => [c.label, c.answers])).toEqual([
      ['16:9', { approvalId, optionIndex: 0 }],
      ['9:16', { approvalId, optionIndex: 1 }],
    ]);
    const turnsBefore = kit.turns(kit.main.conversationId).length;
    const chip = sug.chips[1]!;
    const activeTask = kit.harness.conversationOf(kit.main.conversationId)!.activeTaskId;
    const result = await kit.send(kit.main.conversationId, chip.text, { via: 'suggestion', suggestionChipId: chip.id });
    expect(result).toEqual({ taskId: activeTask });
    const approval = kit.items(kit.main.conversationId).find((i) => i.kind === 'approval' && i.approvalId === approvalId);
    expect(approval).toMatchObject({ status: 'accepted', answers: { q1: ['9:16'] } });
    const message = kit.items(kit.main.conversationId).filter((i) => i.kind === 'user-message').at(-1);
    expect(message).toMatchObject({ text: '9:16', via: 'suggestion', suggestionChipId: chip.id });
    expect(suggestions(kit.main.conversationId).find((s) => s.id === sug.id)).toMatchObject({ state: 'used', usedChipId: chip.id });
    expect(kit.turns(kit.main.conversationId).length).toBe(turnsBefore);
    finish();
    await kit.settle();
  });

  it('a chip that is no longer open is a conflict (SUGGESTION_STALE)', async () => {
    kit = await BotKit.open();
    const { finish } = await askQuestion();
    const sug = suggestions(kit.main.conversationId).find((s) => s.source === 'question')!;
    kit.bot.staleSuggestions(kit.main.conversationId);
    const error = await kit.send(kit.main.conversationId, '16:9', { suggestionChipId: sug.chips[0]!.id }).then(
      () => null,
      (e: unknown) => e as RpcError,
    );
    expect(error).toBeInstanceOf(RpcError);
    expect(error!.code).toBe('conflict');
    expect(error!.details).toMatchObject({ code: 'SUGGESTION_STALE' });
    const unknown = await kit.send(kit.main.conversationId, 'x', { suggestionChipId: 'chip_nope' }).then(
      () => null,
      (e: unknown) => e as RpcError,
    );
    expect(unknown?.code).toBe('conflict');
    finish();
    await kit.settle();
  });

  it('a typed message makes earlier open suggestions stale', async () => {
    kit = await BotKit.open();
    const { finish } = await askQuestion();
    finish();
    await kit.settle();
    expect(suggestions(kit.main.conversationId).at(-1)?.state).toBe('open');
    await kit.send(kit.main.conversationId, 'never mind');
    await kit.settle();
    expect(suggestions(kit.main.conversationId).every((s) => s.state !== 'open')).toBe(true);
  });

  it('wrapBotSteer makes suggestions stale only when the steer landed', async () => {
    let staled = 0;
    const bot = { staleSuggestions: () => void staled++ } as never;
    const steered = wrapBotSteer(() => bot, (() => ({ status: 'steered' })) as never);
    const queued = wrapBotSteer(() => bot, (() => ({ status: 'queued' })) as never);
    await steered({ conversationId: 'c' } as never, desktop);
    await queued({ conversationId: 'c' } as never, desktop);
    expect(staled).toBe(1);
  });
});
