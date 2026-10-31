import { describe, expect, it } from 'vitest';
import type { Conversation, Project } from '@baocut/protocol';
import { buildArchived, buildSidebar, conversationStatus, liveWord, restGroupLabel, sessionStatus, statusGroupLabel } from './sidebar.ts';

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
    expect(sessionStatus(conversation('a', { activity: 'awaiting-answer' }))).toBe('waiting');
    expect(sessionStatus(conversation('a', { activity: 'running' }))).toBe('running');
    expect(sessionStatus(conversation('a', { activity: 'stopping' }))).toBe('running');
    expect(sessionStatus(conversation('a', { activity: 'failed' }))).toBe('failed');
    expect(sessionStatus(conversation('a', { unread: true }))).toBe('unread');
    expect(sessionStatus(conversation('a'))).toBeNull();
  });

  it('只等智能体的提问时写「等待回答」，状态词与等待批准分开', () => {
    expect(conversationStatus(conversation('a', { activity: 'awaiting-answer' }))).toEqual({ label: '等待回答', variant: 'notice' });
    expect(conversationStatus(conversation('a', { activity: 'awaiting-approval' }))).toEqual({ label: '等待批准', variant: 'notice' });
    expect(liveWord(conversation('a', { activity: 'awaiting-answer' }))).toBe('answer');
    expect(liveWord(conversation('a', { activity: 'awaiting-approval' }))).toBe('waiting');
    expect(liveWord(conversation('a', { activity: 'stopping' }))).toBe('running');
    expect(liveWord(conversation('a', { unread: true }))).toBeNull();
  });

  it('正在停止单独显示，不算进行中', () => {
    expect(conversationStatus(conversation('a', { activity: 'stopping' }))).toEqual({ label: '正在停止', variant: 'neutral' });
    expect(conversationStatus(conversation('a', { activity: 'running' }))?.label).toBe('进行中');
  });
});

describe('buildSidebar', () => {
  it('Bot 的频道对话与线程不进 Home 的列表与已归档页', () => {
    const tree = buildSidebar(
      [],
      [conversation('chat'), conversation('legacy', { role: 'chat' }), conversation('chan', { role: 'channel' }), conversation('th', { role: 'thread', pinned: true })],
    );
    expect(tree.loose.map((c) => c.id).sort()).toEqual(['chat', 'legacy']);
    expect(tree.pinned).toEqual([]);
    expect(buildArchived([], [conversation('old', { archived: true }), conversation('th', { role: 'thread', archived: true })]).total).toBe(1);
  });

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
        conversation('c4', { projectId: 'p1', activity: 'awaiting-answer' }),
      ],
    );
    expect(tree.projects[0]?.summary).toBe('1 个等待批准 · 1 个等待回答 · 1 个进行中 · 1 个已完成未读');
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

  it('按状态分组：要你处理的按急迫度分段，空段不出，其余进「其他会话」，段内跟单表的次序', () => {
    const at = (h: number) => `2026-10-01T0${h}:00:00.000Z`;
    const tree = buildSidebar(
      [project('p1')],
      [
        conversation('idle-new', { projectId: 'p1', updatedAt: at(9) }),
        conversation('unread', { unread: true, updatedAt: at(8) }),
        conversation('run', { projectId: 'p1', activity: 'running', updatedAt: at(7) }),
        conversation('ask', { activity: 'awaiting-answer', updatedAt: at(6) }),
        conversation('fail', { activity: 'failed', updatedAt: at(5) }),
        conversation('approve', { projectId: 'p1', activity: 'awaiting-approval', updatedAt: at(4) }),
        conversation('idle-old', { updatedAt: at(3) }),
        conversation('gone', { activity: 'failed', archived: true }),
      ],
    );
    expect(tree.byStatus.groups.map((g) => [g.status, g.conversations.map((c) => c.id)])).toEqual([
      ['waiting', ['ask', 'approve']],
      ['failed', ['fail']],
      ['running', ['run']],
      ['unread', ['unread']],
    ]);
    expect(tree.byStatus.rest.map((c) => c.id)).toEqual(['idle-new', 'idle-old']);
    expect(statusGroupLabel('waiting')).toBe('等你处理');
    expect(statusGroupLabel('failed')).toBe('失败');
    expect(restGroupLabel()).toBe('其他会话');

    const calm = buildSidebar([], [conversation('x')]);
    expect(calm.byStatus).toEqual({ groups: [], rest: [calm.flat[0]] });
  });
});

describe('已归档会话页', () => {
  const at = (h: number) => `2026-10-02T${String(h).padStart(2, '0')}:00:00.000Z`;
  const projects = [project('p1', { name: '访谈' }), project('p2', { name: '发布' })];
  const list = [
    conversation('live', { projectId: 'p1' }),
    conversation('a', { title: '旧的译法讨论', projectId: 'p1', archived: true, archivedAt: at(1) }),
    conversation('b', { title: '封面配色', projectId: 'p2', archived: true, archivedAt: at(9) }),
    conversation('c', { title: '码率问题', archived: true, archivedAt: at(10) }),
    conversation('d', { title: '译法二稿', projectId: 'p1', archived: true, archivedAt: at(5) }),
    conversation('e', { title: '早先归档', projectId: 'gone', archived: true }),
  ];

  it('按项目分组，不属于任何项目的放最后；组内按归档时间从近到远，没记时间的退回最近活动', () => {
    const view = buildArchived(projects, list);
    expect(view.total).toBe(5);
    expect(view.groups.map((g) => g.key)).toEqual(['p2', 'p1', 'none']);
    expect(view.groups[1]!.conversations.map((c) => c.id)).toEqual(['d', 'a']);
    expect(view.groups[2]!.conversations.map((c) => c.id)).toEqual(['c', 'e']);
    expect(view.projects.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(view.hasLoose).toBe(true);
    expect(buildSidebar(projects, list).projects[0]!.conversations.map((c) => c.id)).toEqual(['live']);
  });

  it('按标题搜索、按项目筛选；没有归档时为空', () => {
    const q = buildArchived(projects, list, { query: '译法' });
    expect([q.count, q.groups.map((g) => g.key)]).toEqual([2, ['p1']]);
    expect(buildArchived(projects, list, { scope: 'none' }).groups.map((g) => g.key)).toEqual(['none']);
    expect(buildArchived(projects, [conversation('x')]).total).toBe(0);
  });
});
