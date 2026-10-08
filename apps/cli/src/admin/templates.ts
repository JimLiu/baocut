import { getLocale } from '@baocut/protocol';
import { defineNoun } from './context.ts';
import { M } from './templates-copy.ts';
import { formatTemplateDetail, formatTemplateList } from './templates-output.ts';

/**
 * `baocut templates`：创作模板目录（模板包规范 §6）。模板是给 BaoCut 智能体的简报，外部 Agent 用 skill。
 * 按 CLI 的输出语言要模板的语言版本（规范 §3.6）。
 */
export const templates = defineNoun({
  name: 'templates',
  get usage() {
    return M.help;
  },
  options: {},
  async run(ctx) {
    const [sub, id, ...extra] = ctx.args;
    if (sub === undefined || (sub === 'list' && id === undefined)) {
      const result = await ctx.client.request('templates.list', { language: getLocale() });
      return ctx.done(result, formatTemplateList(result));
    }
    if (sub === 'show' && id && extra.length === 0) {
      const result = await ctx.client.request('templates.get', { id, language: getLocale() });
      return ctx.done(result, formatTemplateDetail(result));
    }
    throw ctx.usageError();
  },
});
