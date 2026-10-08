import { defineNoun } from './context.ts';
import { M } from './tasks-copy.ts';
import { formatContract, formatContractHistory, formatContractList, parseTasksArgs } from './tasks-output.ts';

/** `baocut tasks`：查看任务合同（架构设计 §3.2）。CLI 只读，不改合同。 */
export const tasks = defineNoun({
  name: 'tasks',
  get usage() {
    return M.help;
  },
  options: { revision: { type: 'string' }, conversation: { type: 'string' } },
  async run(ctx) {
    const command = ctx.parse(() => parseTasksArgs(ctx.args, { revision: ctx.values.revision, conversation: ctx.values.conversation }));
    switch (command.kind) {
      case 'contract': {
        const view = await ctx.client.request('tasks.getContract', {
          taskId: command.taskId,
          ...(command.revision !== undefined ? { revision: command.revision } : {}),
        });
        const { results } = await ctx.client.request('tasks.listChecks', { taskId: command.taskId });
        return ctx.done({ ...view, checks: results }, formatContract(view, results));
      }
      case 'history': {
        const result = await ctx.client.request('tasks.listContracts', { taskId: command.taskId });
        return ctx.done(result, formatContractHistory(result.contracts));
      }
      case 'list': {
        const result = await ctx.client.request('tasks.listContracts', { conversationId: command.conversationId });
        return ctx.done(result, formatContractList(result.contracts));
      }
    }
  },
});
