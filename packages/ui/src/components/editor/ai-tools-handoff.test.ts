import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RpcError } from '@baocut/protocol';
import { RuntimeSession } from '../../runtime/session.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { conversationVisible, routeVideo, useShell, type Route } from '../../state/shell-store.ts';
import { handToAgent, sendOrQueue } from './ai-tools-handoff.ts';

vi.mock('@react-spectrum/s2', () => ({ ToastQueue: { info: vi.fn(), negative: vi.fn(), neutral: vi.fn() } }));

/** 假的会话：用 RuntimeSession 自己的 `send`，`client.request` 只记下 `conversations.send` 的参数。 */
function fakeRuntime(fail?: unknown) {
  const sent: Record<string, unknown>[] = [];
  const runtime = Object.create(RuntimeSession.prototype) as RuntimeSession;
  Object.assign(runtime, {
    client: {
      request: async (method: string, params: Record<string, unknown>) => {
        if (method !== 'conversations.send') throw new Error(`没想到会调 ${method}`);
        if (fail) throw fail;
        sent.push(params);
        return { taskId: 'task-1' };
      },
    },
  });
  return { runtime, sent };
}

describe('交给 Agent：挂着的几个 skill 一起发', () => {
  beforeEach(() => {
    useDirectory.setState({ conversations: [] });
    useShell.setState({ queues: {} });
  });

  it('空闲时直接发，skills 按挂上的顺序整组带上', async () => {
    const { runtime, sent } = fakeRuntime();
    const result = await sendOrQueue(
      runtime,
      'c1',
      { text: '写成博客', attachments: [], skills: [{ id: 'blog-post' }, { id: 'caption-layout' }] },
      null,
    );
    expect(result).toEqual({ status: 'sent', taskId: 'task-1' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ conversationId: 'c1', text: '写成博客', skills: [{ id: 'blog-post' }, { id: 'caption-layout' }] });
    expect(sent[0]).not.toHaveProperty('skill');
  });

  it('没挂 skill 时不带 skills', async () => {
    const { runtime, sent } = fakeRuntime();
    await sendOrQueue(runtime, 'c1', { text: 'x', attachments: [], skills: [] }, null);
    expect(sent[0]).not.toHaveProperty('skills');
  });

  it('会话正忙：排队，排队的那条带着整组 skill', async () => {
    const { runtime } = fakeRuntime(new RpcError('busy', '忙'));
    const result = await sendOrQueue(runtime, 'c1', { text: '再来', attachments: [], skills: [{ id: 'a' }, { id: 'b' }] }, null);
    expect(result).toEqual({ status: 'queued' });
    expect(useShell.getState().queues.c1?.[0]).toMatchObject({ text: '再来', skills: [{ id: 'a' }, { id: 'b' }] });
  });
});

/** 假的会话：`conversations.create` 回一条新会话，`conversations.send` 记下参数。 */
function handoffRuntime() {
  const calls: string[] = [];
  const runtime = Object.create(RuntimeSession.prototype) as RuntimeSession;
  Object.assign(runtime, {
    client: {
      request: async (method: string, params: Record<string, unknown>) => {
        calls.push(method);
        if (method === 'conversations.create') return { conversation: { id: 'c-new', projectId: params.projectId } };
        if (method === 'conversations.send') return { taskId: 'task-1' };
        throw new Error(`没想到会调 ${method}`);
      },
    },
  });
  return { runtime, calls };
}

describe('交给 Agent：那条会话打开到眼前', () => {
  const video = { videoId: 'v1', name: '访谈', path: '/p/访谈', source: { projectId: 'p1', conversationId: null }, relPath: '访谈' };
  const target = { entryId: 'e1' };
  const request = { video, session: 'new' as const, text: '写成博客', attachments: [], skills: [], draftKey: 'tool:v1:blog' };

  beforeEach(() => {
    useDirectory.setState({ conversations: [] });
    useShell.setState({ queues: {}, views: {}, workspaces: {}, workspaceNarrow: false, hiddenBeforeNarrow: false });
  });

  it('从 Space 打开的视频：新建会话、发出去，转到 Home 的这条会话，视频作为标签留在右边', async () => {
    useShell.setState({ route: { tab: 'space', category: 'all', projectId: 'p1', video: target } as unknown as Route });
    const { runtime, calls } = handoffRuntime();
    expect(await handToAgent(runtime, request)).toMatchObject({ conversationId: 'c-new', taskId: 'task-1', drafted: false });
    expect(calls).toEqual(['conversations.create', 'conversations.send']);
    const state = useShell.getState();
    expect(state.route).toMatchObject({ tab: 'home', conversationId: 'c-new' });
    expect(routeVideo(state.route)).toEqual(target);
    expect(conversationVisible(state, 'c-new')).toBe(true);
  });

  it('窄窗口里：选中会话标签，会话露出来', async () => {
    useShell.setState({
      route: { tab: 'home', conversationId: 'c-old', projectId: null, pane: { kind: 'video', target } } as unknown as Route,
      workspaceNarrow: true,
    });
    const { runtime } = handoffRuntime();
    expect(await handToAgent(runtime, request)).not.toBeNull();
    const state = useShell.getState();
    expect(state.route).toMatchObject({ tab: 'home', conversationId: 'c-new' });
    expect(conversationVisible(state, 'c-new')).toBe(true);
  });

  it('接着当前会话：不新建，转到那一条', async () => {
    useDirectory.setState({ conversations: [{ id: 'c-old' }] as never });
    useShell.setState({ route: { tab: 'space', category: 'all', projectId: 'p1', video: target } as unknown as Route });
    const { runtime, calls } = handoffRuntime();
    expect(await handToAgent(runtime, { ...request, session: { id: 'c-old' } })).toMatchObject({ conversationId: 'c-old' });
    expect(calls).toEqual(['conversations.send']);
    expect(useShell.getState().route).toMatchObject({ tab: 'home', conversationId: 'c-old' });
    expect(conversationVisible(useShell.getState(), 'c-old')).toBe(true);
  });
});

describe('交给 Agent：找可剪的口与刷新过期译文留在原地', () => {
  const video = { videoId: 'v1', name: '访谈', path: '/p/访谈', source: { projectId: 'p1', conversationId: null }, relPath: '访谈' };
  const target = { entryId: 'e1' };
  const request = { video, session: 'new' as const, text: '找可剪的口', attachments: [], skills: [], draftKey: 'aitool:v1:cleanup', stay: true };

  beforeEach(() => {
    useDirectory.setState({ conversations: [] });
    useShell.setState({ queues: {}, views: {}, workspaces: {}, videoChats: {}, drafts: {}, workspaceNarrow: false, hiddenBeforeNarrow: false });
  });

  it('Home 里开着的视频：会话照样建好、话照样发出去，路由不动，带回会话与任务号', async () => {
    const route = { tab: 'home', conversationId: 'c-old', projectId: null, pane: { kind: 'video', target } } as unknown as Route;
    useShell.setState({ route });
    const { runtime, calls } = handoffRuntime();
    expect(await handToAgent(runtime, request)).toMatchObject({ conversationId: 'c-new', taskId: 'task-1', drafted: false });
    expect(calls).toEqual(['conversations.create', 'conversations.send']);
    expect(useShell.getState().route).toEqual(route);
  });

  it('从 Space 打开的视频：只记成这个视频的悬浮会话，不转到 Home', async () => {
    const route = { tab: 'space', category: 'all', projectId: 'p1', video: target } as unknown as Route;
    useShell.setState({ route });
    const { runtime } = handoffRuntime();
    expect(await handToAgent(runtime, request)).toMatchObject({ conversationId: 'c-new' });
    const state = useShell.getState();
    expect(state.route).toEqual(route);
    expect(Object.values(state.videoChats)).toEqual(['c-new']);
  });

  it('话没发出去：放进那条会话的输入框，会话打开到眼前', async () => {
    useShell.setState({ route: { tab: 'space', category: 'all', projectId: 'p1', video: target } as unknown as Route });
    const runtime = Object.create(RuntimeSession.prototype) as RuntimeSession;
    Object.assign(runtime, {
      client: {
        request: async (method: string) => {
          if (method === 'conversations.create') return { conversation: { id: 'c-new', projectId: 'p1' } };
          throw new Error('断了');
        },
      },
    });
    expect(await handToAgent(runtime, request)).toMatchObject({ conversationId: 'c-new', taskId: null, drafted: true });
    const state = useShell.getState();
    expect(state.drafts['c-new']).toBe('找可剪的口');
    expect(state.route).toMatchObject({ tab: 'home', conversationId: 'c-new' });
  });
});
