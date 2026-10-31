import { RpcError, type RpcMethod, type RpcParams, type RpcResult } from '@baocut/protocol';
import { RcBot } from '@baocut/protocol/messages/runtime-core';
import type { Harness } from '@baocut/harness';
import type { TrustedPrincipal } from '../gateway.ts';
import type { BotService } from './bot-service.ts';

/*
 * Bot 模式的方法表（技术方案 §16.1），由 `handlers.ts` 并进方法表。主体都是用户：智能体的连接调用一律 `forbidden`。
 * 另外包住 `conversations.send` / `steer`：频道对话与线程会话里先核验提示、算前置，发出后把提示改成 used（§12.3）。
 */

type Handler<M extends RpcMethod> = (params: RpcParams<M>, principal: TrustedPrincipal) => RpcResult<M> | Promise<RpcResult<M>>;

type BotMethod =
  | 'channels.list'
  | 'channels.ensureMain'
  | 'channels.create'
  | 'channels.update'
  | 'channels.archive'
  | 'channels.unarchive'
  | 'channels.delete'
  | 'channels.readMemory'
  | 'channels.writeMemory'
  | 'channels.markSeen'
  | 'channels.export'
  | 'bot.readUserMemory'
  | 'bot.writeUserMemory'
  | 'bot.settings'
  | 'workItems.list'
  | 'workItems.get'
  | 'workItems.create'
  | 'workItems.update'
  | 'workItems.transition'
  | 'workItems.stop'
  | 'workItems.redirect'
  | 'workItems.refresh'
  | 'workItems.move'
  | 'workItems.revertAll'
  | 'workItems.deleteRecord'
  | 'bot.proposals.respond'
  | 'bot.make.run'
  | 'bot.react'
  | 'bot.status'
  | 'bot.awaySummary'
  | 'bot.inbox'
  | 'bot.pauseAutomation'
  | 'conversations.editMessage';

export function botMethods(getBot: () => BotService | null): { [M in BotMethod]: Handler<M> } {
  const need = (principal: TrustedPrincipal): BotService => {
    if (principal.kind === 'agent' || principal.kind === 'service') throw new RpcError('forbidden', RcBot.userOnly());
    const bot = getBot();
    if (!bot) throw new RpcError('unsupported', RcBot.notReady());
    return bot;
  };
  return {
    'channels.list': (_p, pr) => ({ channels: need(pr).listChannels() }),
    'channels.ensureMain': async (_p, pr) => ({ channel: await need(pr).ensureMain() }),
    'channels.create': async ({ commandId: _c, ...p }, pr) => ({ channel: await need(pr).createChannel(p) }),
    'channels.update': async (p, pr) => ({ channel: await need(pr).updateChannel(p.id, p.patch) }),
    'channels.archive': async (p, pr) => ({ channel: await need(pr).archiveChannel(p.id, true) }),
    'channels.unarchive': async (p, pr) => ({ channel: await need(pr).archiveChannel(p.id, false) }),
    'channels.delete': async (p, pr) => {
      await need(pr).deleteChannel(p.id, p.confirm);
      return { deleted: true as const };
    },
    'channels.readMemory': (p, pr) => need(pr).readMemory(p.id),
    'channels.writeMemory': async (p, pr) => {
      const bot = need(pr);
      const result = await bot.writeMemory(p.id, p.content, p.ifVersion);
      await bot.refreshMemoryCache(p.id);
      return { version: result.version };
    },
    'channels.markSeen': async (p, pr) => ({ channel: await need(pr).markSeen(p.id, p.itemId) }),
    'channels.export': async (p, pr) => ({ path: await need(pr).exportChannel(p.id, p.dir) }),
    'bot.readUserMemory': (_p, pr) => need(pr).readUserMemory(),
    'bot.writeUserMemory': (p, pr) => need(pr).writeUserMemory(p.content, p.ifVersion),
    'bot.settings': async (p, pr) => {
      const bot = need(pr);
      return { settings: p.patch ? await bot.updateSettings(p.patch) : bot.settings() };
    },
    'workItems.list': (p, pr) =>
      p.limit !== undefined || p.cursor !== undefined
        ? need(pr).pageItems(p.channelId, { status: p.status, limit: p.limit, cursor: p.cursor ?? null })
        : { items: need(pr).listItems(p.channelId, p.status), nextCursor: null },
    'workItems.get': (p, pr) => need(pr).getItem(p.id),
    'workItems.create': async ({ commandId: _c, start, ...p }, pr) => ({
      item: await need(pr).createItem(
        {
          channelId: p.channelId,
          title: p.title,
          titleBy: 'user',
          owner: p.owner,
          description: p.description ?? '',
          ...(p.priority ? { priority: p.priority } : {}),
          dueOn: p.dueOn ?? null,
          ...(p.dueOn ? { dueOnBy: 'user' as const } : {}),
          source: { kind: 'manual', messageId: null, scheduleId: null, runId: null },
        },
        { start: start === true, attended: true },
      ),
    }),
    'workItems.update': async (p, pr) => ({ item: await need(pr).updateItem(p.id, p.patch) }),
    'workItems.transition': async (p, pr) => ({ item: await need(pr).userTransition(p.id, p.event) }),
    'workItems.stop': async (p, pr) => ({ item: await need(pr).stopItem(p.id) }),
    'workItems.redirect': async (p, pr) => ({ item: await need(pr).redirectItem(p.id, p.text, p.oldWork) }),
    'workItems.refresh': async (p, pr) => ({ delivered: await need(pr).refreshItem(p.id) }),
    'workItems.move': async (p, pr) => ({ item: await need(pr).moveItem(p.id, p.toChannelId) }),
    'workItems.revertAll': (p, pr) => need(pr).revertAll(p.id, p.dryRun === true, p.keepUserEdits === true),
    'workItems.deleteRecord': (p, pr) => need(pr).deleteRecord(p.id, p.dryRun === true, p.confirm),
    'bot.proposals.respond': (p, pr) => need(pr).respondProposal(p.conversationId, p.itemId, p.accept, p.edits),
    'bot.make.run': (p, pr) => need(pr).runMake(p.channelId, 'manual'),
    'bot.react': (p, pr) => need(pr).react(p.conversationId, p.itemId, p.emoji),
    'bot.status': (_p, pr) => need(pr).status(),
    'bot.awaySummary': (p, pr) => need(pr).awaySummary(p.channelId),
    'bot.inbox': (_p, pr) => ({ rows: need(pr).inbox() }),
    'bot.pauseAutomation': async (p, pr) => ({ paused: await need(pr).pauseAutomation(p.paused) }),
    'conversations.editMessage': async (p, pr) => ({ item: await need(pr).editMessage(p.conversationId, p.itemId, p.text) }),
  };
}

/**
 * 频道对话与线程会话里的发送（§12.3、§12.4、§8.4）：先核验点的提示、算前置；答案提示直接回答提问卡，不另起回合；
 * 发出后提示改 used、其余作废，「标为完成」提示以用户身份关任务。别的会话原样转给 `inner`。
 */
export function wrapBotSend(
  getBot: () => BotService | null,
  harness: Pick<Harness, 'conversationOf'>,
  inner: Handler<'conversations.send'>,
): Handler<'conversations.send'> {
  return async (params, principal) => {
    const bot = getBot();
    const conversation = harness.conversationOf(params.conversationId);
    if (!bot || !conversation || (conversation.role !== 'channel' && conversation.role !== 'thread')) {
      if (params.via || params.suggestionChipId || params.replyToItemId) {
        const { via: _v, suggestionChipId: _s, replyToItemId: _r, ...rest } = params;
        return inner(rest, principal);
      }
      return inner(params, principal);
    }
    const { chip, suggestionsItemId, accessMode } = await bot.beforeSend({
      conversationId: params.conversationId,
      text: params.text,
      ...((params.accessMode ?? params.autonomy) ? { accessMode: (params.accessMode ?? params.autonomy)! } : {}),
      ...(params.via ? { via: params.via } : {}),
      ...(params.suggestionChipId ? { suggestionChipId: params.suggestionChipId } : {}),
      ...(params.replyToItemId ? { replyToItemId: params.replyToItemId } : {}),
    });
    if (chip?.answers && suggestionsItemId) {
      await bot.answerWithChip(params.conversationId, chip, suggestionsItemId);
      const taskId = harness.conversationOf(params.conversationId)?.activeTaskId;
      if (!taskId) throw new RpcError('conflict', RcBot.chipStale());
      return { taskId };
    }
    // 频道上限压低了模式时按压低后的发（§14.4）。
    const sent = await inner({ ...params, ...(accessMode ? { accessMode } : {}), ...(chip ? { via: 'suggestion' as const } : {}) }, principal);
    const messageId = (sent as { messageId?: string }).messageId ?? latestUserMessage(bot, params.conversationId, sent.taskId);
    await bot.afterSend(params, { messageId: messageId ?? '' }, chip, suggestionsItemId);
    return sent;
  };
}

export function wrapBotSteer(getBot: () => BotService | null, inner: Handler<'conversations.steer'>): Handler<'conversations.steer'> {
  return async (params, principal) => {
    const result = await inner(params, principal);
    const bot = getBot();
    if (bot && result.status === 'steered') bot.staleSuggestions(params.conversationId);
    return result;
  };
}

function latestUserMessage(bot: BotService, conversationId: string, taskId: string): string | null {
  // `conversations.send` 只回 taskId：那一回合的用户消息是任务条目之前的最后一条 user-message。
  void taskId;
  const run = bot.runOf(conversationId);
  return run?.userMessageId ?? null;
}
