import { describe, expect, it } from 'vitest';
import type { TrustedPrincipal } from '../gateway.ts';
import { projectGitMethods } from './project-git-methods.ts';
import type { ProjectGitService } from './project-git-service.ts';

/** 初始化与允许本地过滤器只给桌面界面与 CLI；Web 的状态与提交按 Web 的视图。 */
describe('projects.git.* 的连接限制', () => {
  const calls: string[] = [];
  const git = {
    status: async (_id: string, view: { web?: boolean }) => (calls.push(`status:${view.web}`), { projectId: 'prj_1' }),
    commit: async (_id: string, _options: unknown, view: { web?: boolean }) => (calls.push(`commit:${view.web}`), { committed: false }),
    init: async () => (calls.push('init'), { projectId: 'prj_1' }),
    allowLocalConfig: async () => (calls.push('allow'), { projectId: 'prj_1' }),
  } as unknown as ProjectGitService;
  const methods = projectGitMethods(() => git);
  const as = (kind: TrustedPrincipal['kind']) => ({ kind }) as TrustedPrincipal;

  it.each(['web', 'service', 'agent', 'local'] as const)('%s 不能初始化或允许过滤器', async (kind) => {
    await expect(methods['projects.git.init']({ projectId: 'prj_1' }, as(kind))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(methods['projects.git.allowLocalConfig']({ projectId: 'prj_1', digest: 'sha256:x' }, as(kind))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('桌面界面与 CLI 可以；Web 的状态与提交用 Web 的视图', async () => {
    calls.length = 0;
    await methods['projects.git.init']({ projectId: 'prj_1' }, as('desktop'));
    await methods['projects.git.allowLocalConfig']({ projectId: 'prj_1', digest: 'sha256:x' }, as('cli'));
    await methods['projects.git.status']({ projectId: 'prj_1' }, as('web'));
    await methods['projects.git.commit']({ projectId: 'prj_1' }, as('web'));
    await methods['projects.git.status']({ projectId: 'prj_1' }, as('desktop'));
    expect(calls).toEqual(['init', 'allow', 'status:true', 'commit:true', 'status:false']);
  });
});
