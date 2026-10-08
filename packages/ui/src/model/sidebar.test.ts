import { describe, expect, it } from 'vitest';
import type { Conversation, Project } from '@baocut/protocol';
import { buildSidebar, conversationStatus, sessionStatus } from './sidebar.ts';

const project = (id: string, patch: Partial<Project> = {}): Project => ({
  id,
  name: id,
  path: `/work/${id}`,
  createdAt: '2026-10-01T00:00:00.000Z',
  lastActiveAt: '2026-10-01T00:00:00.000Z',
  pinned: false,
  archived: false,
  ...patch,
});
const conversation = (id: string, patch: Partial<Conversation> = {}): Conversation => ({
  id,
  title: id,
  projectId: null,
  cwd: `/tmp/${id}`,
  driverId: 'codex',
  model: null,
  effort: null,
  accessMode: 'ask',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  archived: false,
  pinned: false,
  unread: false,
  activity: 'idle',
  activeTaskId: null,
  ...patch,
});

describe('会话状态', () => {
  it('把活动与未读映射成侧栏的四种状态', () => {
    expect(sessionStatus(conversation('a', { activity: 'awaiting-approval' }))).toBe('waiting');
    expect(sessionStatus(conversation('a', { activity: 'running' }))).toBe('running');
    expect(sessionStatus(conversation('a', { activity: 'stopping' }))).toBe('running');
    expect(sessionStatus(conversation('a', { activity: 'failed' }))).toBe('failed');
    expect(sessionStatus(conversation('a', { unread: true }))).toBe('unread');
    expect(sessionStatus(conversation('a'))).toBeNull();
  });

  it('正在停止单独显示，不算进行中', () => {
    expect(conversationStatus(conversation('a', { activity: 'stopping' }))).toEqual({ label: '正在停止', variant: 'neutral' });
    expect(conversationStatus(conversation('a', { activity: 'running' }))?.label).toBe('进行中');
  });
});

describe('buildSidebar', () => {
  it('项目按最近活动排，会话挂在项目下；不属于项目的进「最近」', () => {
    const tree = buildSidebar(
      [project('p1'), project('p2', { lastActiveAt: '2026-10-01T01:00:00.000Z' })],
      [
        conversation('c1', { projectId: 'p1', updatedAt: '2026-10-01T02:00:00.000Z' }),
        conversation('c2', { projectId: 'p1', updatedAt: '2026-10-01T03:00:00.000Z' }),
        conversation('c3'),
      ],
    );
    expect(tree.projects.map((r) => r.project.id)).toEqual(['p1', 'p2']);
    expect(tree.projects[0]?.conversations.map((c) => c.id)).toEqual(['c2', 'c1']);
    expect(tree.loose.map((c) => c.id)).toEqual(['c3']);
    expect(tree.pinned).toEqual([]);
  });

  it('置顶的项目与会话同时还在原来的位置；归档的不显示', () => {
    const tree = buildSidebar(
      [project('p1', { pinned: true }), project('p2', { archived: true })],
      [conversation('c1', { pinned: true }), conversation('c2', { archived: true })],
    );
    expect(tree.pinned.map((pin) => (pin.kind === 'project' ? pin.row.project.id : pin.conversation.id))).toEqual(['p1', 'c1']);
    expect(tree.projects.map((r) => r.project.id)).toEqual(['p1']);
    expect(tree.loose.map((c) => c.id)).toEqual(['c1']);
  });

  it('项目汇总下面会话的状态，要动手的在前', () => {
    const tree = buildSidebar(
      [project('p1')],
      [
        conversation('c1', { projectId: 'p1', activity: 'running' }),
        conversation('c2', { projectId: 'p1', activity: 'awaiting-approval' }),
        conversation('c3', { projectId: 'p1', unread: true }),
      ],
    );
    expect(tree.projects[0]?.summary).toBe('1 个等待批准 · 1 个进行中 · 1 个已完成未读');
  });

  it('会话可以按名称排；「在一个列表中」收齐项目下与不属于项目的会话', () => {
    const tree = buildSidebar(
      [project('p1'), project('p2', { archived: true })],
      [
        conversation('c1', { projectId: 'p1', title: '字幕', updatedAt: '2026-10-01T03:00:00.000Z' }),
        conversation('c2', { projectId: 'p1', title: '开场', updatedAt: '2026-10-01T02:00:00.000Z' }),
        conversation('c3', { title: '配音', updatedAt: '2026-10-01T01:00:00.000Z' }),
        conversation('c4', { projectId: 'p2', title: '归档项目里的' }),
      ],
      'name',
    );
    // 按拼音：开场 < 配音 < 字幕；归档项目里的会话不进单表。
    expect(tree.projects[0]?.conversations.map((c) => c.id)).toEqual(['c2', 'c1']);
    expect(tree.flat.map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);
    const recent = buildSidebar([project('p1')], [conversation('a', { projectId: 'p1', updatedAt: '2026-10-01T09:00:00.000Z' }), conversation('b')]);
    expect(recent.flat.map((c) => c.id)).toEqual(['a', 'b']);
  });
});
