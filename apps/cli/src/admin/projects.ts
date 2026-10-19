import { defineNoun } from './context.ts';
import { M } from './projects-copy.ts';
import { formatConfigEntries, formatGitStatus, resolveProject } from './projects-output.ts';

/**
 * 管理桶 `baocut projects git-status|git-init|git-allow`（版本记录设计 §5、架构设计 §5.12）。提交在 Agent 面
 * （`projects git-commit`）；初始化与允许本地过滤器只给桌面界面与 CLI，智能体与 Web 不能做。
 */
export const projects = defineNoun({
  name: 'projects',
  partial: true,
  verbs: ['git-status', 'git-init', 'git-allow'],
  get usage() {
    return M.help;
  },
  options: { yes: { type: 'boolean' } },
  async run(ctx) {
    const [sub, ...rest] = ctx.args;
    if (rest.length > 1) throw ctx.usageError();
    const { projects: list } = await ctx.client.request('projects.list', {});
    const project = resolveProject(list, rest[0], ctx.cwd);
    switch (sub) {
      case 'git-status': {
        const result = await ctx.client.request('projects.git.status', { projectId: project.id });
        return ctx.done(result, formatGitStatus(project, result.status));
      }
      case 'git-init': {
        const result = await ctx.client.request('projects.git.init', { projectId: project.id });
        return ctx.done(result, [M.initDone(result.status.repoRoot ?? project.path), ...formatGitStatus(project, result.status)]);
      }
      case 'git-allow': {
        const { status } = await ctx.client.request('projects.git.status', { projectId: project.id });
        const local = status.pause?.reason === 'local-config' ? status.pause.localConfig : undefined;
        if (!local) return ctx.done({ allowed: false, status }, [M.nothingToAllow]);
        for (const line of formatConfigEntries(status)) ctx.log(line);
        const agreed = await ctx.confirm(M.allowPrompt, ctx.values.yes, M.notTtyAllow);
        if (!agreed) return ctx.done({ allowed: false, status }, [M.notAllowed]);
        const result = await ctx.client.request('projects.git.allowLocalConfig', { projectId: project.id, digest: local.digest });
        return ctx.done({ allowed: true, ...result }, [M.allowed, ...formatGitStatus(project, result.status)]);
      }
      default:
        throw ctx.usageError();
    }
  },
});
