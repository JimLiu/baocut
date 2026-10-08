import { newId } from '@baocut/protocol';
import { defineNoun } from './context.ts';
import { M } from './space-copy.ts';
import { formatSpaceContinue, formatSpacePurge, formatVideoDelete, parseSpaceArgs } from './space-output.ts';

/**
 * 管理桶 `baocut space rescan|rebuild|trash|restore|purge|delete-video|continue`（架构设计 §5.7、§5.11）。
 * 列出与检索在 Agent 面（`space list|search`）。
 */
export const space = defineNoun({
  name: 'space',
  partial: true,
  verbs: ['rescan', 'rebuild', 'trash', 'restore', 'purge', 'delete-video', 'continue'],
  get usage() {
    return M.help;
  },
  options: { conversation: { type: 'string' } },
  async run(ctx) {
    const command = ctx.parse(() => parseSpaceArgs(ctx.args, { conversation: ctx.values.conversation }));
    switch (command.kind) {
      case 'rescan': {
        const result = await ctx.client.request('space.rescan', {});
        return ctx.done(result, [M.rescanStarted]);
      }
      case 'rebuild': {
        const result = await ctx.client.request('space.rebuildIndex', {});
        return ctx.done(result, [M.rebuilt(result.entries, result.pendingVideos)]);
      }
      case 'purge': {
        const result = await ctx.client.request('space.purge', { entryId: command.entryId });
        if (result.status === 'blocked') {
          for (const line of formatSpacePurge(result)) ctx.log(line);
          return ctx.fail({ code: 'PURGE_BLOCKED', message: M.purgeBlocked(command.entryId), ...result });
        }
        return ctx.done(result, formatSpacePurge(result));
      }
      case 'delete-video': {
        const result = await ctx.client.request('videos.delete', { entryId: command.entryId });
        const view = await ctx.client.request('settings.get', { keys: ['space.trashRetentionDays'] }).catch(() => null);
        return ctx.done(result, formatVideoDelete(result, view?.settings['space.trashRetentionDays'] ?? null));
      }
      case 'continue': {
        const result = await ctx.client.request('space.continueInConversation', {
          entryId: command.entryId,
          ...(command.conversationId ? { conversationId: command.conversationId } : {}),
          commandId: newId('cmd'),
        });
        return ctx.done(result, formatSpaceContinue(result));
      }
      case 'trash':
      case 'restore': {
        const result = await ctx.client.request(command.kind === 'trash' ? 'space.trash' : 'space.restore', { entryId: command.entryId });
        return ctx.done(result, [
          (command.kind === 'trash' ? M.movedToTrash : M.restoredFromTrash)(result.entry.id, result.entry.name),
        ]);
      }
      default:
        throw ctx.usageError();
    }
  },
});
