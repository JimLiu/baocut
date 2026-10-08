import { describe, expect, it } from 'vitest';
import { ProjectTools } from './project-tools.ts';
import type { ToolPrincipal, ToolScope } from './tool-scope.ts';

/** `projects_list` 一个项目都没有时：各个面的 next 给出各自能走的路（终端的情形不必起 Runtime）。 */
describe('projects_list 的空列表', () => {
  const scope = {
    authorize: (principal: ToolPrincipal) => ({ principal, submitter: { kind: 'connection', id: 'c' } }),
    listProjects: async () => [],
  } as unknown as ToolScope;
  const tools = new ProjectTools({ harness: {} as never, videos: {} as never, scope });
  const list = (principal: Partial<ToolPrincipal>) =>
    tools.dispatch('projects_list', {}, principal as ToolPrincipal) as Promise<{ projects: unknown[]; next: string }>;

  it('终端：videos_create 不给 project 时落到默认的 CLI 项目，或先 projects_create', async () => {
    const { projects, next } = await list({ kind: 'local', cwd: '/tmp', projectDir: null } as Partial<ToolPrincipal>);
    expect(projects).toEqual([]);
    expect(next).toContain('projects_create');
    expect(next).toContain('CLI 项目');
    expect(next).not.toContain('把项目目录（path）作为');
  });

  it('对外服务：不能新建项目，请用户登记或在终端 mcp install', async () => {
    const { next } = await list({ kind: 'service' } as Partial<ToolPrincipal>);
    expect(next).toContain('baocut projects create');
    expect(next).toContain('baocut mcp install');
  });

  it('会话：不属于项目时 videos_create 先建项目并绑定', async () => {
    const { next } = await list({ kind: 'agent' } as Partial<ToolPrincipal>);
    expect(next).toContain('不属于任何项目');
  });
});
