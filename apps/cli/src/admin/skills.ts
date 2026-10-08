import { newId } from '@baocut/protocol';
import { defineNoun } from './context.ts';
import { M } from './skills-copy.ts';
import { formatSkillChanged, parseSkillId } from './skills-output.ts';

/**
 * 管理桶 `baocut skills add|import|enable|disable|remove`（架构设计 §3.8、§12.9）：添加、导入与移除只经桌面界面与 CLI。
 * 列出与读取在 Agent 面（`skills list|read`）。
 */
export const skills = defineNoun({
  name: 'skills',
  partial: true,
  verbs: ['add', 'import', 'enable', 'disable', 'remove'],
  get usage() {
    return M.skillsHelp;
  },
  options: { id: { type: 'string' } },
  async run(ctx) {
    const [sub, arg, ...extra] = ctx.args;
    const idOption = ctx.parse(() => parseSkillId(ctx.values.id, '--id'));
    if (!arg || extra.length > 0 || (idOption !== undefined && sub !== 'add' && sub !== 'import')) throw ctx.usageError();
    const id = idOption === undefined ? {} : { id: idOption };
    if (sub === 'add') {
      const result = await ctx.client.request('skills.add', { path: ctx.resolve(arg), ...id, commandId: newId('cmd') });
      return ctx.done(result, [formatSkillChanged(M.added, result.skill)]);
    }
    if (sub === 'import') {
      const result = await ctx.client.request('skills.importGithub', { url: arg, ...id, commandId: newId('cmd') });
      const { skill } = result;
      const lines = [formatSkillChanged(M.imported, skill)];
      if (!skill.enabled) lines.push(M.reviewFirst(skill.id));
      return ctx.done(result, lines);
    }
    if (sub === 'enable' || sub === 'disable') {
      const result = await ctx.client.request('skills.setEnabled', { id: arg, enabled: sub === 'enable' });
      return ctx.done(result, [
        formatSkillChanged(sub === 'enable' ? M.turnedOn : M.turnedOff, result.skill),
        M.takesEffectNextSession,
      ]);
    }
    const result = await ctx.client.request('skills.remove', { id: arg });
    return ctx.done(result, [M.removed(result.removed.id, result.removed.path)]);
  },
});
