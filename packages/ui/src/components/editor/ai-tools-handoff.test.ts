import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RpcError } from '@baocut/protocol';
import { RuntimeSession } from '../../runtime/session.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { sendOrQueue } from './ai-tools-handoff.ts';

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
    expect(result).toBe('sent');
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
    expect(result).toBe('queued');
    expect(useShell.getState().queues.c1?.[0]).toMatchObject({ text: '再来', skills: [{ id: 'a' }, { id: 'b' }] });
  });
});
