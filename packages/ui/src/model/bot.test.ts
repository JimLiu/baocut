import { describe, expect, it } from 'vitest';
import type { Channel, ChannelGroup, ChannelSummary, InboxRow, SuggestionChip, TimelineItem, WorkItem } from '@baocut/protocol';
import {
  CHANNEL_STATUS_FILTERS,
  channelLook,
  channelTree,
  defaultChannelColor,
  nameProblem,
  chipAction,
  chipAllowed,
  groupInbox,
  inboxRowAction,
  canRevertItem,
  questionAnswerRoute,
  isOverdue,
  localDate,
  makeGallery,
  MAKE_EARLIER_MAX,
  needsYouTotal,
  findOutput,
  opensAsTab,
  outputKey,
  outputKind,
  suggestionPreview,
  openChips,
  statusKey,
  taskSections,
  tabCounts,
  tabOf,
  defaultTab,
  TASK_TABS,
  wantedWorkItemChannels,
} from './bot.ts';

const NOW = Date.parse('2026-10-31T12:00:00Z');

function group(id: string, name: string): ChannelGroup {
  return { id, name, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
}

function channel(id: string, patch: Partial<Channel> = {}, counts: Partial<ChannelSummary['counts']> = {}, lastActivityAt = '2026-10-30T00:00:00Z'): ChannelSummary {
  return {
    channel: {
      id,
      kind: 'topic',
      name: id,
      purpose: '',
      icon: null,
      color: null,
      groupId: null,
      conversationId: `conv_${id}`,
      driverId: 'claude',
      model: null,
      effort: null,
      defaultAccessMode: null,
      maxAccessMode: null,
      templateId: null,
      pinned: false,
      archived: false,
      archivedAt: null,
      limits: { concurrentThreads: 3, dailyBudget: null, monthlyBudget: null },
      outputLanguage: null,
      private: false,
      muted: false,
      stallMinutes: null,
      lastSeen: null,
      memoryVersion: 0,
      seedPending: null,
      unwantedKinds: [],
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
      ...patch,
    },
    unread: false,
    counts: { needsYou: 0, working: 0, upNext: 0, suggested: 0, scheduled: 0, open: 0, ...counts },
    lastActivityAt,
    spend: null,
  };
}

function item(id: string, patch: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    channelId: 'c1',
    title: id,
    titleBy: 'user',
    description: '',
    owner: 'agent',
    status: 'upNext',
    active: null,
    resolution: null,
    priority: 'medium',
    dueOn: null,
    eventOn: null,
    startAt: null,
    steps: [],
    finishedSteps: [],
    updates: [],
    outcome: null,
    question: null,
    resources: [],
    outputs: [],
    dependsOn: [],
    overrides: null,
    baseVersions: [],
    lastProgressAt: null,
    budgetWarnedAt: null,
    files: [],
    suggestion: null,
    source: { kind: 'manual', messageId: null, scheduleId: null, runId: null },
    threadId: null,
    threadStarts: 0,
    lastReportId: null,
    deferredStop: null,
    beforeInput: null,
    reminded: [],
    createdAt: '2026-10-30T00:00:00Z',
    updatedAt: '2026-10-30T00:00:00Z',
    ...patch,
  };
}

const active = (id: string, state: NonNullable<WorkItem['active']>['state'], patch: Partial<WorkItem> = {}) =>
  item(id, { status: 'active', active: { state, reason: null, since: '2026-10-30T00:00:00Z' }, ...patch });

function chip(id: string, patch: Partial<SuggestionChip> = {}): SuggestionChip {
  return {
    id,
    label: id,
    text: `say ${id}`,
    kind: 'answer',
    kindTag: null,
    fillOnly: false,
    recommended: false,
    answers: null,
    target: null,
    action: null,
    ...patch,
  };
}

const base = { createdAt: '2026-10-31T00:00:00Z', taskId: null } as const;
const agent = (id: string, text = 'hi'): TimelineItem => ({ ...base, id, kind: 'agent-message', text, streaming: false }) as TimelineItem;
const user = (id: string): TimelineItem => ({ ...base, id, kind: 'user-message', text: 'yo' }) as TimelineItem;
const suggestions = (id: string, forItemId: string, chips: SuggestionChip[], state: 'open' | 'used' | 'stale' = 'open'): TimelineItem =>
  ({ ...base, id, kind: 'suggestions', forItemId, source: 'agent', chips, state, usedChipId: null }) as TimelineItem;

describe('bot model', () => {
  it('maps a work item to its status row', () => {
    expect(statusKey(item('a'))).toBe('upNext');
    expect(statusKey(active('a', 'needsInput'))).toBe('needsInput');
    expect(statusKey(item('a', { status: 'resolved', resolution: { kind: 'merged', by: 'user', at: base.createdAt, evidence: null, confirmedBy: null, mergedInto: 'b' } }))).toBe(
      'merged',
    );
    expect(statusKey(item('a', { status: 'resolved' }))).toBe('done');
  });

  it('sums needs-you over every channel, muted and archived included', () => {
    const rows = [channel('a', {}, { needsYou: 2 }), channel('b', { muted: true }, { needsYou: 1 }), channel('c', { archived: true }, { needsYou: 3 })];
    expect(needsYouTotal(rows)).toBe(6);
  });

  it('puts the main channel on top, loose channels pinned first then by recent activity, and each group in creation order', () => {
    const groups = [group('g1', 'Clients'), group('g2', 'Empty')];
    const tree = channelTree(
      [
        channel('old', {}, {}, '2026-10-01T00:00:00Z'),
        channel('new', {}, {}, '2026-10-29T00:00:00Z'),
        channel('pin', { pinned: true }, {}, '2026-09-01T00:00:00Z'),
        channel('main', { kind: 'main' }, {}, '2026-08-01T00:00:00Z'),
        channel('gone', { archived: true }),
        channel('acme', { groupId: 'g1' }, {}, '2026-10-02T00:00:00Z'),
        channel('beta', { groupId: 'g1', pinned: true }, {}, '2026-09-02T00:00:00Z'),
        channel('lost', { groupId: 'g_missing' }, {}, '2026-08-02T00:00:00Z'),
      ],
      groups,
      'active',
    );
    expect(tree.main?.channel.id).toBe('main');
    // 分组不在了的频道按没分组算。
    expect(tree.loose.map((r) => r.channel.id)).toEqual(['pin', 'new', 'old', 'lost']);
    expect(tree.groups.map((g) => [g.group.id, g.rows.map((r) => r.channel.id)])).toEqual([
      ['g1', ['beta', 'acme']],
      ['g2', []],
    ]);
  });

  it('filters channels by status; only the archived view drops empty groups', () => {
    const rows = [
      channel('main', { kind: 'main' }),
      channel('live'),
      channel('gone', { archived: true }),
      channel('old', { archived: true, groupId: 'g1' }),
    ];
    const groups = [group('g1', 'Clients'), group('g2', 'Empty')];
    const ids = (status: (typeof CHANNEL_STATUS_FILTERS)[number]) => {
      const tree = channelTree(rows, groups, status);
      return { main: tree.main?.channel.id, loose: tree.loose.map((r) => r.channel.id), groups: tree.groups.map((g) => `${g.group.id}:${g.rows.length}`) };
    };
    expect(ids('active')).toEqual({ main: 'main', loose: ['live'], groups: ['g1:0', 'g2:0'] });
    expect(ids('archived')).toEqual({ main: 'main', loose: ['gone'], groups: ['g1:1'] });
    expect(ids('all').loose).toEqual(['live', 'gone']);
  });

  it('derives a channel look: main is Layers without a hue, others fall back to Chat and a stable hue from the id', () => {
    expect(channelLook(channel('main', { kind: 'main', icon: 'Star', color: 'red' }).channel)).toEqual({ icon: 'Layers', color: null });
    expect(channelLook(channel('a', { icon: 'Star', color: 'red' }).channel)).toEqual({ icon: 'Star', color: 'red' });
    const look = channelLook(channel('chan_x').channel);
    expect(look.icon).toBe('Chat');
    expect(look.color).toBe(defaultChannelColor('chan_x'));
    expect(defaultChannelColor('chan_x')).toBe(defaultChannelColor('chan_x'));
  });

  it('checks channel and group names: required, trimmed, at most the limit', () => {
    expect(nameProblem('  ', 40)).toBe('required');
    expect(nameProblem(' Podcast ', 40)).toBeNull();
    expect(nameProblem('x'.repeat(41), 40)).toBe('tooLong');
  });

  it('subscribes the open channel and channels that need you', () => {
    const rows = [channel('a', {}, { needsYou: 1 }), channel('b'), channel('c', {}, { needsYou: 2 })];
    expect(wantedWorkItemChannels(rows, 'b')).toEqual(['a', 'b', 'c']);
    expect(wantedWorkItemChannels(rows, null)).toEqual(['a', 'c']);
  });

  it('subscribes every live channel while Make looks at all channels', () => {
    const rows = [channel('a'), channel('b'), channel('gone', { archived: true }), channel('c', {}, { needsYou: 1 })];
    expect(wantedWorkItemChannels(rows, 'a', true)).toEqual(['a', 'b', 'c']);
  });

  it('splits tasks into the panel tabs: active grouped by sub-state, scheduled apart from up next', () => {
    const items = [
      active('w', 'working'),
      active('wait', 'waitingOnOthers'),
      active('blocked', 'blocked'),
      active('input', 'needsInput'),
      active('review', 'needsReview'),
      item('next-low', { priority: 'low' }),
      item('next-due', { dueOn: '2026-11-02' }),
      item('next-nodue'),
      item('sched', { status: 'scheduled', startAt: '2026-11-01T09:00:00Z' }),
      item('s1', { status: 'suggested' }),
      item('s2', { status: 'suggested' }),
      item('s3', { status: 'suggested' }),
      item('s4', { status: 'suggested' }),
      item('done-old', { status: 'resolved', updatedAt: '2026-08-01T00:00:00Z' }),
      item('done-new', { status: 'resolved', updatedAt: '2026-10-30T00:00:00Z' }),
    ];
    const sections = taskSections(items, 'all', NOW);
    expect(sections.active.map((g) => [g.state, g.items.map((i) => i.id)])).toEqual([
      ['needsReview', ['review']],
      ['needsInput', ['input']],
      ['blocked', ['blocked']],
      ['working', ['w']],
      ['waitingOnOthers', ['wait']],
    ]);
    expect(sections.upNext.map((i) => i.id)).toEqual(['next-due', 'next-nodue', 'next-low']);
    expect(sections.scheduled.map((i) => i.id)).toEqual(['sched']);
    expect(tabCounts(sections)).toEqual({ active: 5, upNext: 3, scheduled: 1, resolved: 0 });
    expect(sections.done.map((i) => i.id)).toEqual(['done-new']);
    expect(sections.moreDone).toBe(1);
    expect(taskSections(items, 'all', NOW, true).done.map((i) => i.id)).toEqual(['done-new', 'done-old']);
  });

  it('places each task in one tab and starts on the first tab that has tasks', () => {
    expect(TASK_TABS).toEqual(['active', 'upNext', 'scheduled', 'resolved']);
    expect(tabOf(item('a', { status: 'scheduled' }))).toBe('scheduled');
    expect(tabOf(item('a', { status: 'suggested' }))).toBeNull();
    expect(defaultTab(taskSections([item('next')], 'all', NOW))).toBe('upNext');
    expect(defaultTab(taskSections([item('d', { status: 'resolved', updatedAt: '2026-10-30T00:00:00Z' })], 'all', NOW))).toBe('resolved');
    expect(defaultTab(taskSections([item('next'), active('w', 'working')], 'all', NOW))).toBe('active');
    expect(defaultTab(taskSections([item('s', { status: 'suggested' })], 'all', NOW))).toBe('active');
  });

  it('filters by owner', () => {
    const items = [item('mine', { owner: 'user' }), item('bot')];
    expect(taskSections(items, 'mine', NOW).upNext.map((i) => i.id)).toEqual(['mine']);
    expect(taskSections(items, 'agent', NOW).upNext.map((i) => i.id)).toEqual(['bot']);
  });

  it('works out overdue in the user time zone', () => {
    expect(localDate(Date.parse('2026-10-31T23:30:00Z'), 'Asia/Shanghai')).toBe('2026-11-01');
    expect(localDate(Date.parse('2026-10-31T23:30:00Z'), 'UTC')).toBe('2026-10-31');
    expect(isOverdue(item('a', { dueOn: '2026-10-30' }), '2026-10-31')).toBe(true);
    expect(isOverdue(item('a', { dueOn: '2026-10-31' }), '2026-10-31')).toBe(false);
    expect(isOverdue(item('a', { dueOn: '2026-10-01', status: 'resolved' }), '2026-10-31')).toBe(false);
  });

  it('groups inbox rows by channel keeping the urgency order', () => {
    const row = (channelId: string, workItemId: string): InboxRow => ({
      channelId,
      channelName: channelId.toUpperCase(),
      workItemId,
      title: workItemId,
      state: 'needsInput',
      question: null,
      approval: null,
      priority: 'medium',
      since: base.createdAt,
    });
    const groups = groupInbox([row('b', '1'), row('a', '2'), row('b', '3')]);
    expect(groups.map((g) => [g.channelId, g.rows.map((r) => r.workItemId)])).toEqual([
      ['b', ['1', '3']],
      ['a', ['2']],
    ]);
  });

  it('shows chips only under the latest agent message', () => {
    const chips = [chip('a'), chip('b'), chip('c'), chip('d'), chip('e')];
    const items = [user('u1'), agent('m1'), suggestions('s1', 'm1', chips)];
    expect(openChips(items)?.chips.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(openChips([...items, user('u2')])).toBeNull();
    expect(openChips([...items, agent('m2')])).toBeNull();
    expect(openChips([user('u1'), agent('m1'), suggestions('s1', 'm1', chips, 'used')])).toBeNull();
  });

  it('hides chips that break the wording rules', () => {
    expect(chipAllowed(chip('a', { text: 'see https://example.com' }))).toBe(false);
    expect(chipAllowed(chip('a', { text: 'x'.repeat(81) }))).toBe(false);
    expect(chipAllowed(chip('a', { kind: 'other', text: '' }))).toBe(true);
    expect(chipAllowed(chip('a'))).toBe(true);
  });

  it('decides what a chip press does', () => {
    expect(chipAction(chip('a'))).toBe('send');
    expect(chipAction(chip('a', { kind: 'other' }))).toBe('focus');
    expect(chipAction(chip('a', { kind: 'starter', fillOnly: true }))).toBe('fill');
  });
});

describe('canRevertItem', () => {
  const video = { kind: 'video', projectId: 'p1', videoId: 'v1' } as const;
  it('offers undo once a thread worked on a task with videos; the dialog checks what actually changed', () => {
    expect(canRevertItem(item('a', { threadId: 'conv_t', resources: [video] }))).toBe(true);
    expect(canRevertItem(item('b', { threadId: null, resources: [video] }))).toBe(false);
    expect(canRevertItem(item('c', { threadId: 'conv_t', resources: [] }))).toBe(false);
    expect(canRevertItem(item('d', { baseVersions: [{ projectId: 'p1', videoId: 'v1', version: 2 }] }))).toBe(true);
  });
});

describe('inboxRowAction', () => {
  const question = (options: string[], askedBy: 'thread' | 'system' = 'thread') =>
    ({ text: 'Q', kind: 'input', options: options.map((label) => ({ label, description: null })), pick: null, risky: false, askedBy, approvalId: 'ap1' }) as InboxRow['question'];
  const approval = { approvalId: 'ap1', summary: 'run ffmpeg', cost: null };

  it('answers questions with options in place', () => {
    expect(inboxRowAction({ question: question(['A', 'B']), approval }, true)).toBe('answer');
  });

  it('gives allow and deny for an authorization wrapped in a question without options', () => {
    expect(inboxRowAction({ question: question([], 'system'), approval }, true)).toBe('approve');
    expect(inboxRowAction({ question: null, approval }, true)).toBe('approve');
  });

  it('a question card that cannot be answered in one tap opens the task instead of offering allow and deny', () => {
    expect(inboxRowAction({ question: question([]), approval }, true)).toBe('open');
  });

  it('opens the task for open questions and tasks without a thread', () => {
    expect(inboxRowAction({ question: question([]), approval: null }, true)).toBe('open');
    expect(inboxRowAction({ question: question(['A']), approval: null }, false)).toBe('open');
  });
});

describe('questionAnswerRoute', () => {
  const q = (askedBy: 'thread' | 'coordinator' | 'system', approvalId: string | null, labels: string[]) => ({
    askedBy,
    approvalId,
    options: labels.map((label) => ({ label, description: null })),
  });

  it('a question the runtime asked continues or stops the task instead of messaging the thread', () => {
    expect(questionAnswerRoute(q('system', null, ['Continue', 'Stop']), 0)).toBe('continue');
    expect(questionAnswerRoute(q('system', null, ['Continue', 'Stop']), 1)).toBe('stop');
    expect(questionAnswerRoute(q('system', null, ['Continue']), 0)).toBe('continue');
  });

  it('a question card is answered on the card; a report question is sent as a message', () => {
    expect(questionAnswerRoute(q('thread', 'ap1', ['A', 'B']), 1)).toBe('card');
    expect(questionAnswerRoute(q('system', 'ap1', ['A']), 0)).toBe('card');
    expect(questionAnswerRoute(q('thread', null, ['Yes', 'No']), 0)).toBe('message');
  });
});

describe('Make panel', () => {
  const suggested = (id: string, channelId: string, updatedAt: string, kindTag = 'captions') =>
    item(id, {
      channelId,
      status: 'suggested',
      updatedAt,
      suggestion: { reason: '', owner: 'agent', evidence: [], trigger: 'manual', kindTag, subjectKey: id, expiresAt: '2026-11-07T00:00:00Z' },
    });

  it('keeps up to three suggestions per channel, newest first across channels', () => {
    const items = [
      suggested('a1', 'a', '2026-10-31T01:00:00Z'),
      suggested('a2', 'a', '2026-10-31T02:00:00Z'),
      suggested('a3', 'a', '2026-10-31T03:00:00Z'),
      suggested('a4', 'a', '2026-10-31T04:00:00Z'),
      suggested('b1', 'b', '2026-10-31T05:00:00Z'),
      item('busy', { status: 'upNext' }),
    ];
    expect(makeGallery(items, NOW).suggestions.map((i) => i.id)).toEqual(['b1', 'a4', 'a3', 'a2']);
  });

  it('lists outputs newest first, split at local midnight, and skips references that are not outputs', () => {
    const midnight = new Date(NOW);
    midnight.setHours(0, 0, 0, 0);
    const iso = (offsetMs: number) => new Date(midnight.getTime() + offsetMs).toISOString();
    const out = (label: string, path: string) => ({ kind: 'file' as const, path, label, version: null });
    const resolved = (at: string) => ({ kind: 'done' as const, by: 'thread' as const, at, evidence: null, confirmedBy: null, mergedInto: null });
    const items = [
      item('today', { status: 'resolved', resolution: resolved(iso(3_600_000)), outputs: [out('Cut', '/a/cut.mp4'), out('Subs', '/a/cut.srt')] }),
      item('working', { status: 'active', updatedAt: iso(7_200_000), outputs: [{ kind: 'message', conversationId: 'c', itemId: 'm', label: 'Note', version: null }] }),
      ...Array.from({ length: MAKE_EARLIER_MAX + 2 }, (_, n) =>
        item(`old${n}`, { status: 'resolved', resolution: resolved(iso(-(n + 1) * 3_600_000)), outputs: [out(`Old ${n}`, `/a/old${n}.png`)] }),
      ),
    ];
    const gallery = makeGallery(items, NOW);
    expect(gallery.today.map((o) => [o.output.label, o.kind])).toEqual([
      ['Cut', 'video'],
      ['Subs', 'subtitle'],
    ]);
    expect(gallery.earlier).toHaveLength(MAKE_EARLIER_MAX);
    expect(gallery.earlier[0]!.output.label).toBe('Old 0');
    expect(gallery.earlier[0]!.kind).toBe('image');
  });

  it('maps output references and suggestion kinds to what the cards draw', () => {
    expect(outputKind({ kind: 'video', projectId: 'p', videoId: 'v', label: 'V', version: null })).toBe('video');
    expect(outputKind({ kind: 'video-range', projectId: 'p', videoId: 'v', startMs: 0, endMs: 1, label: 'V', version: null })).toBe('video');
    expect(outputKind({ kind: 'work-item', workItemId: 'w', label: 'W', version: null })).toBeNull();
    expect(suggestionPreview('highlights')).toBe('clips');
    expect(suggestionPreview('derive-shorts')).toBe('clips');
    expect(suggestionPreview('translate-draft')).toBe('captions');
    expect(suggestionPreview('Captions')).toBe('captions');
    expect(suggestionPreview('tidy')).toBe('idea');
    expect(suggestionPreview(null)).toBe('idea');
  });

  it('keys outputs by reference so a tab keeps its output when the list is merged and trimmed', () => {
    const cover = { kind: 'file', path: '/out/cover.png', label: 'Cover', version: 'v1' } as const;
    const coverV2 = { ...cover, label: 'Cover v2', version: 'v2' } as const;
    const range = { kind: 'video-range', projectId: 'p', videoId: 'v', startMs: 1000, endMs: 5000, label: 'Clip', version: null } as const;
    expect(outputKey(cover)).toBe('file:/out/cover.png');
    expect(outputKey(range)).toBe('range:v:1000-5000');
    expect(outputKey({ kind: 'slides', id: 's1' })).toBe('slides:s1');
    const item = { outputs: [cover, range, coverV2] } as unknown as WorkItem;
    expect(findOutput(item, 'file:/out/cover.png')).toBe(coverV2);
    expect(findOutput(item, 'video:v')).toBeNull();
    expect(findOutput(null, 'file:/out/cover.png')).toBeNull();
    expect(opensAsTab(cover)).toBe(true);
    expect(opensAsTab(range)).toBe(true);
    expect(opensAsTab({ kind: 'doc', id: 'd1' })).toBe(false);
    expect(opensAsTab({ kind: 'message', conversationId: 'c', itemId: 'm' })).toBe(false);
  });
});
