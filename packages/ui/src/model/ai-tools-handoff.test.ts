import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '@baocut/protocol';
import { agentRunState, currentConversation, mergeDraft, messageCount, planHandoff } from './ai-tools-handoff.ts';

const at = (id: string, projectId: string | null, updatedAt: string, archived = false) => ({ id, projectId, title: id, archived, updatedAt });
const conversations = [
  at('c1', 'p1', '2026-10-01T00:00:00Z'),
  at('c4', 'p1', '2026-10-05T00:00:00Z'),
  at('c5', 'p1', '2026-10-08T00:00:00Z', true),
  at('c2', 'p2', '2026-10-09T00:00:00Z'),
  at('c3', null, '2026-10-02T00:00:00Z'),
];
const inProject = { projectId: 'p1', conversationId: null };
const outside = { projectId: null, conversationId: 'c3' };

describe('「接着」指哪条会话', () => {
  it('当前就在一条同项目的会话里：就是它，哪怕不是最近的、已归档', () => {
    expect(currentConversation({ source: inProject, current: 'c1', conversations })?.id).toBe('c1');
    expect(currentConversation({ source: inProject, current: 'c5', conversations })?.id).toBe('c5');
  });

  it('当前会话在别的项目、不在会话里或刚删掉：这个项目里最近更新、没归档的那条', () => {
    expect(currentConversation({ source: inProject, current: 'c2', conversations })?.id).toBe('c4');
    expect(currentConversation({ source: inProject, current: null, conversations })?.id).toBe('c4');
    expect(currentConversation({ source: inProject, current: 'gone', conversations })?.id).toBe('c4');
    expect(currentConversation({ source: { projectId: 'p9', conversationId: null }, current: null, conversations })).toBeNull();
  });

  it('视频在一条无项目会话的目录里：就是那条；那条不在了就没有', () => {
    expect(currentConversation({ source: outside, current: 'c1', conversations })?.id).toBe('c3');
    expect(currentConversation({ source: { projectId: null, conversationId: 'gone' }, current: null, conversations })).toBeNull();
    expect(currentConversation({ source: null, current: 'c1', conversations })).toBeNull();
  });
});

describe('交给 Agent 发到哪', () => {
  it('新会话建在视频的项目里；视频不属于项目时交不出去', () => {
    expect(planHandoff({ session: 'new', source: inProject, conversations })).toEqual({ kind: 'create', projectId: 'p1' });
    expect(planHandoff({ session: 'new', source: outside, conversations })).toEqual({ kind: 'none' });
    expect(planHandoff({ session: 'new', source: null, conversations })).toEqual({ kind: 'none' });
  });

  it('接着的那条要还在', () => {
    expect(planHandoff({ session: { id: 'c4' }, source: inProject, conversations })).toEqual({ kind: 'existing', conversationId: 'c4' });
    expect(planHandoff({ session: { id: 'gone' }, source: inProject, conversations })).toEqual({ kind: 'none' });
  });

  it('消息数只数说的话', () => {
    expect(messageCount([{ kind: 'user-message' }, { kind: 'reasoning' }, { kind: 'tool-call' }, { kind: 'agent-message' }, { kind: 'task' }])).toBe(2);
    expect(messageCount([])).toBe(0);
  });
});

describe('填进输入框的草稿', () => {
  it('输入框是空的：就是这句', () => {
    expect(mergeDraft(undefined, '润色。')).toBe('润色。');
    expect(mergeDraft('  ', ' 润色。 ')).toBe('润色。');
  });

  it('输入框里有字：接在后面，不覆盖；同一句不重复填', () => {
    expect(mergeDraft('先看看第 2 章 ', '润色。')).toBe('先看看第 2 章\n\n润色。');
    expect(mergeDraft('先看看\n\n润色。', '润色。')).toBe('先看看\n\n润色。');
  });

  it('没有要填的：原样留着', () => {
    expect(mergeDraft('写了一半', '')).toBe('写了一半');
  });
});

describe('留在原地的工具页：交出去的那一次走到哪了', () => {
  const base = { createdAt: '2026-10-10T08:00:00Z' };
  const task = (id: string, status: 'running' | 'completed' | 'failed' | 'stopped', startedAt = '2026-10-10T08:00:00Z') =>
    ({ ...base, kind: 'task', id, taskId: id, goal: 'x', status, startedAt, endedAt: null, error: status === 'failed' ? '没连上' : null }) as TimelineItem;
  const call = (taskId: string, title: string) =>
    ({ ...base, kind: 'tool-call', id: `call-${title}`, taskId, tool: 'command', title, detail: null, output: '', status: 'completed', exitCode: 0, durationMs: 1 }) as TimelineItem;
  const approval = (taskId: string, status: 'pending' | 'accepted') =>
    ({ ...base, kind: 'approval', id: `ap-${status}`, taskId, approvalId: 'a1', request: { kind: 'command', command: 'bcut cleanup', cwd: null, reason: null }, status, decidedAt: null }) as TimelineItem;
  const handedAt = '2026-10-10T08:00:00Z';

  it('时间线还没读到、或任务还没出现：正在开始', () => {
    expect(agentRunState({ taskId: 't1', handedAt, items: undefined })).toEqual({ kind: 'starting' });
    expect(agentRunState({ taskId: 't1', handedAt, items: [task('t0', 'completed')] })).toEqual({ kind: 'starting' });
  });

  it('在跑：最近一步的标题；有待批的审批就是等放行，批了接着跑', () => {
    expect(agentRunState({ taskId: 't1', handedAt, items: [task('t1', 'running'), call('t1', '读文稿'), call('t1', '找停顿')] })).toEqual({
      kind: 'running',
      step: '找停顿',
    });
    expect(agentRunState({ taskId: 't1', handedAt, items: [task('t1', 'running'), call('t1', '读文稿'), approval('t1', 'pending')] })).toEqual({
      kind: 'waiting',
      step: '读文稿',
    });
    expect(agentRunState({ taskId: 't1', handedAt, items: [task('t1', 'running'), approval('t1', 'accepted')] })).toEqual({ kind: 'running', step: null });
  });

  it('别的任务的步骤与审批不算', () => {
    expect(agentRunState({ taskId: 't1', handedAt, items: [task('t0', 'running'), approval('t0', 'pending'), task('t1', 'running')] })).toEqual({
      kind: 'running',
      step: null,
    });
  });

  it('任务结束按它的状态', () => {
    expect(agentRunState({ taskId: 't1', handedAt, items: [task('t1', 'completed')] })).toEqual({ kind: 'done' });
    expect(agentRunState({ taskId: 't1', handedAt, items: [task('t1', 'stopped')] })).toEqual({ kind: 'stopped' });
    expect(agentRunState({ taskId: 't1', handedAt, items: [task('t1', 'failed')] })).toEqual({ kind: 'failed', error: '没连上', errorRef: null });
  });

  it('排了队没有任务号：认交出去之后开始的第一个任务，不认之前同一句话的那次', () => {
    const items = [task('t0', 'completed', '2026-10-10T07:00:00Z'), task('t1', 'running', '2026-10-10T08:00:05Z'), task('t2', 'completed', '2026-10-10T08:10:00Z')];
    expect(agentRunState({ taskId: null, handedAt, items })).toEqual({ kind: 'running', step: null });
    expect(agentRunState({ taskId: null, handedAt, items: items.slice(0, 1) })).toEqual({ kind: 'starting' });
  });
});
