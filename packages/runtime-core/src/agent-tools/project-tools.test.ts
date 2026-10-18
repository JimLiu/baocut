import { describe, expect, it } from 'vitest';
import { ProjectTools } from './project-tools.ts';
import type { ToolConfirmation, ToolPrincipal, ToolScope } from './tool-scope.ts';

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

  it('会话：不属于项目时新视频建在会话的工作目录里，用户要建项目时才用 projects_adopt_session', async () => {
    const { next } = await list({ kind: 'agent' } as Partial<ToolPrincipal>);
    expect(next).toContain('不属于任何项目');
    expect(next).toContain('工作目录');
    expect(next).toContain('projects_adopt_session');
  });
});

/** `projects_adopt_session`：给不给 `project` 走两种确认，绑定交给范围（`ToolScope.bindSession`）。范围与 Harness 都是假的。 */
describe('projects_adopt_session', () => {
  const agent = { kind: 'agent', conversationId: 'conv_1' } as unknown as ToolPrincipal;

  function setup(projectId: string | null = null) {
    const confirmed: ToolConfirmation[] = [];
    const bound: unknown[] = [];
    const project = { id: 'prj_new', name: '访谈', path: '/Volumes/T7/访谈' };
    const scope = {
      authorize: (principal: ToolPrincipal) => ({ principal, submitter: { kind: 'agent', id: 'conv_1' } }),
      confirm: async (_access: unknown, request: ToolConfirmation) => {
        confirmed.push(request);
        return { mode: 'ask', risk: request.risk ?? 'command', decidedBy: 'user' };
      },
      locateBinding: async (_access: unknown, target: string) => ({ path: target, project: null }),
      bindSession: async (_access: unknown, options: unknown) => {
        bound.push(options);
        return project;
      },
    } as unknown as ToolScope;
    const harness = {
      getConversation: () => ({ conversation: { id: 'conv_1', projectId, cwd: '/sessions/conv_1' } }),
      listProjects: () => (projectId ? [{ id: projectId, name: '已有', path: '/p' }] : []),
    };
    const tools = new ProjectTools({ harness: harness as never, videos: {} as never, scope });
    const adopt = (args: Record<string, unknown>) => tools.dispatch('projects_adopt_session', args, agent) as Promise<Record<string, unknown>>;
    return { adopt, confirmed, bound };
  }

  it('给了 project：按 high 确认、卡上写明目录，放进那里；不给时在默认目录下新建、按 edit', async () => {
    const into = setup();
    const result = await into.adopt({ project: '/Volumes/T7/访谈', name: '访谈' });
    expect(into.confirmed[0]).toMatchObject({ tool: 'projects_adopt_session', risk: 'high', targets: ['/sessions/conv_1', '/Volumes/T7/访谈'] });
    expect(into.confirmed[0]!.summary).toContain('/Volumes/T7/访谈');
    expect(into.bound).toEqual([{ binding: { path: '/Volumes/T7/访谈', project: null }, name: '访谈' }]);
    expect(result).toMatchObject({ projectId: 'prj_new', path: '/Volumes/T7/访谈', created: true });

    const fresh = setup();
    await fresh.adopt({});
    expect(fresh.confirmed[0]).toMatchObject({ risk: 'edit', targets: ['/sessions/conv_1'] });
    expect(fresh.bound).toEqual([{}]);
  });

  it('已经属于项目：原样返回，不确认、不绑定', async () => {
    const owned = setup('prj_old');
    expect(await owned.adopt({ project: '/Volumes/T7/访谈' })).toMatchObject({ projectId: 'prj_old', created: false, existing: true });
    expect(owned.confirmed).toEqual([]);
    expect(owned.bound).toEqual([]);
  });
});
