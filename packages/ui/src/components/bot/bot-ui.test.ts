// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeContext } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import type { AwaySummary, TimelineItem } from '@baocut/protocol';
import { BotThreadExtrasContext } from '../thread/bot-items.ts';
import { Thread } from '../thread/thread.tsx';
import { AwayBanner, ChannelSpend, ReplyTarget, useAwayAndSeen } from './channel-view.tsx';
import { WorkItemRefCard } from './timeline/work-item-ref-card.tsx';
import { ChannelSettingsDialog } from './channel-dialog.tsx';
import { BotDialogs } from './channel-dialogs.tsx';
import { useBotLayout, type BotDialog } from '../../state/bot-layout-store.ts';
import { drainQueue, sendQueuedMessageNow } from '../../runtime/message-queue-runner.ts';
import { TaskPanel } from './task-panel.tsx';
import { useWorkItems } from '../../state/work-items-store.ts';
import { DeleteRecordDialog, RevertDialog, ThreadChips, dateFact, menuActions } from './task-detail.tsx';
import { TaskRefs, resourceLabel } from './task-refs.tsx';
import { fileRefTarget, refOutput } from '../../model/bot-refs.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { TaskEditDialog } from './task-edit-dialog.tsx';
import { Reactions, UserMessageExtras } from './timeline/message-extras.tsx';
import { ScheduleDialog } from '../agent-schedule/schedule-dialog.tsx';
import { DialogContainer, ToastQueue } from '@react-spectrum/s2';
import { useTimeline } from '../../state/timeline-store.ts';
import { BotSettings } from '../settings/bot-settings.tsx';
import { useChannels } from '../../state/channels-store.ts';
import { DEFAULT_BOT_SETTINGS, type JobRecord, type SpaceEntry, type WorkItem } from '@baocut/protocol';
import { ProposalCard, SuggestionButtons } from './timeline/proposal-card.tsx';
import { useBotCall, useScopedState } from './bot-actions.ts';
import { ChannelMemoryPage } from './channel-memory-page.tsx';
import { ChannelSidebar } from './channel-sidebar.tsx';
import { MakePanel } from './make-panel.tsx';
import { useShell } from '../../state/shell-store.ts';
import { useSpace } from '../../state/space-store.ts';

/*
 * Bot 页组件的行为测试（docs/design/bot-mode 需求 §11）：假的 Runtime 只记下发了哪些 RPC，按方法给出结果。
 */

type Handler = (params: Record<string, unknown>) => unknown;

let container: HTMLDivElement;
let root: Root;
let handlers: Record<string, Handler>;
const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
  const handler = handlers[method];
  if (!handler) throw new Error(`unexpected ${method}`);
  return handler(params);
});
const runtime = { client: { request } } as unknown as RuntimeSession;

async function render(element: ReactElement) {
  await act(() => root.render(createElement(RuntimeContext.Provider, { value: runtime }, element)));
}

function calls(method: string): Record<string, unknown>[] {
  return request.mock.calls.filter(([m]) => m === method).map(([, p]) => p);
}

function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label);
}

async function press(label: string) {
  const target = button(label);
  if (!target) throw new Error(`no button ${label}`);
  await act(async () => target.click());
}

async function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// happy-dom 没有 Web Animations；SegmentedControl 的选中滑块要用它。
Element.prototype.getAnimations ??= () => [];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  handlers = {};
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  request.mockClear();
  vi.unstubAllGlobals();
});

describe('频道侧栏（BOT-CH-02、需求 §11.2）', () => {
  const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    channel: {
      id,
      name,
      kind: id === 'chan_main' ? 'main' : 'custom',
      purpose: '',
      pinned: false,
      muted: false,
      private: false,
      archived: false,
      icon: null,
      color: null,
      groupId: null,
      ...extra,
    },
    unread: false,
    counts: { needsYou: 0 },
    lastActivityAt: '2026-10-31T00:00:00.000Z',
    spend: null,
  });
  const group = { id: 'grp_shows', name: '节目', createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z' };

  // 分组与条目共用一个键（比如收件箱组与收件箱都叫 inbox）时，集合的前后链接成环，找第一项时死循环，整页卡死。
  it('主频道下挂没分组的频道，分组另起一段；归档的默认不列，主频道行尾是筛选与「＋」', async () => {
    useChannels.setState({
      ready: true,
      groups: [group],
      channels: [
        row('chan_main', 'Main'),
        row('chan_notes', 'Notes'),
        row('chan_pod', 'Podcast', { groupId: 'grp_shows', icon: 'Microphone', color: 'orange' }),
        row('chan_old', 'Old', { archived: true }),
      ] as never,
    });
    try {
      await render(createElement(ChannelSidebar));
      const keys = () => [...document.querySelectorAll('[data-bc-row]')].map((e) => e.getAttribute('data-key'));
      expect(keys()).toEqual(['inbox', 'chan_main', 'chan_notes', 'chan_pod']);
      expect(new Set([...document.querySelectorAll('[data-key]')].map((e) => e.getAttribute('data-key'))).size).toBe(document.querySelectorAll('[data-key]').length);
      expect([...document.querySelectorAll('[data-bc-child]')].map((e) => e.getAttribute('data-key'))).toEqual(['chan_notes', 'chan_pod']);
      // 原来底部的「已归档」折叠组由主频道行尾的筛选代替。
      expect(button('筛选频道：进行中')).toBeDefined();
      expect(button('新建')).toBeDefined();
      expect(document.querySelector('[aria-label="已归档的频道"]')).toBeNull();
      const create = button('新建频道')!;
      expect(document.querySelector('[data-key="chan_pod"]')!.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // 分组行可以折叠；行尾有分组的「⋯」与「＋」。
      const toggle = [...document.querySelectorAll('button[aria-expanded]')].find((b) => b.textContent?.includes('节目'))!;
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(button('在「节目」里新建频道')).toBeDefined();
      await act(async () => (toggle as HTMLButtonElement).click());
      expect(keys()).toEqual(['inbox', 'chan_main', 'chan_notes']);
      // 「新建频道」开 App 外壳里的对话框。
      await press('新建频道');
      expect(useBotLayout.getState().dialog).toEqual({ kind: 'newChannel' });
    } finally {
      useChannels.setState({ channels: [], groups: [] });
      useBotLayout.setState({ dialog: null });
    }
  });
});

describe('频道的对话框（需求 §11.2、§2.3）', () => {
  const summary = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    channel: { id, name, kind: 'custom', purpose: '', archived: false, pinned: false, muted: false, private: false, icon: null, color: null, groupId: null, ...extra },
    unread: false,
    counts: { needsYou: 0, working: 0, open: 2, scheduled: 1 },
    lastActivityAt: '2026-10-31T00:00:00.000Z',
    spend: null,
  });
  const group = { id: 'grp_shows', name: '节目', createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z' };
  const open = async (dialog: BotDialog) => {
    useChannels.setState({ ready: true, groups: [group], channels: [summary('c1', '剪辑')] as never });
    useBotLayout.setState({ dialog });
    await render(createElement(BotDialogs));
  };
  const field = () => document.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!;
  afterEach(() => {
    useChannels.setState({ channels: [], groups: [] });
    useBotLayout.setState({ dialog: null });
  });

  it('重命名只交名字；名字没变就直接关掉', async () => {
    handlers['channels.update'] = () => ({ channel: {} });
    await open({ kind: 'rename', channelId: 'c1' });
    expect(field().value).toBe('剪辑');
    await typeInto(field(), '  粗剪  ');
    await press('保存');
    expect(calls('channels.update')).toEqual([{ id: 'c1', patch: { name: '粗剪' } }]);
    expect(useBotLayout.getState().dialog).toBeNull();
  });

  it('从分组行新建频道：只问名字，建在那个分组里', async () => {
    handlers['channels.create'] = () => ({ channel: { id: 'c9' } });
    await open({ kind: 'newChannel', groupId: 'grp_shows' });
    expect(container.ownerDocument.body.textContent).toContain('节目');
    await typeInto(field(), '访谈');
    await press('建立');
    expect(calls('channels.create')).toEqual([{ name: '访谈', groupId: 'grp_shows' }]);
  });

  it('名字是空的不能建', async () => {
    await open({ kind: 'newChannel' });
    expect(button('建立')?.disabled || button('建立')?.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('频道菜单「移到分组 › 新建分组…」：建分组时把这个频道一起移进去', async () => {
    handlers['channelGroups.create'] = () => ({ group: { id: 'grp_new' } });
    await open({ kind: 'newGroup', moveChannelId: 'c1' });
    await typeInto(field(), '素材');
    await press('新建分组');
    expect(calls('channelGroups.create')).toEqual([{ name: '素材', channelIds: ['c1'] }]);
  });

  it('归档确认写明没解决的任务与定时任务怎么办，确认后交 channels.archive', async () => {
    handlers['channels.archive'] = () => ({ channel: {} });
    await open({ kind: 'archive', channelId: 'c1' });
    const text = document.body.textContent ?? '';
    expect(text).toContain('2 个没解决的任务');
    expect(text).toContain('1 个定时任务会暂停');
    await press('归档');
    expect(calls('channels.archive')).toEqual([{ id: 'c1' }]);
  });

  it('删除确认里可以改为归档', async () => {
    handlers['channels.delete'] = () => {
      throw new Error('confirm mismatch');
    };
    handlers['channels.archive'] = () => ({ channel: {} });
    await open({ kind: 'delete', channelId: 'c1' });
    await press('改为归档');
    expect(calls('channels.archive')).toEqual([{ id: 'c1' }]);
    expect(calls('channels.delete').every((p) => (p.confirm as { threads: number }).threads === -1)).toBe(true);
  });

  it('改说明：交 purpose', async () => {
    handlers['channels.update'] = () => ({ channel: {} });
    await open({ kind: 'instructions', channelId: 'c1' });
    await typeInto(document.querySelector('textarea')!, '只做播客剪辑');
    await press('保存');
    expect(calls('channels.update')).toEqual([{ id: 'c1', patch: { purpose: '只做播客剪辑' } }]);
  });
});

describe('新建任务（需求 §4.4）', () => {
  const selectedTab = () => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent;

  it('面板头下面直接输入：默认「我来做」、不马上开始；添加后切到新任务所在的页签，输入行留着', async () => {
    useWorkItems.setState({ byChannel: { c1: { items: [], resolvedTail: 20, reports: [] } } });
    handlers['workItems.create'] = (p) => ({ item: { ...resolvedItem(9), id: 'wi_new', title: p.title, owner: p.owner, status: 'upNext', resolution: null } });
    try {
      await render(createElement(TaskPanel, { channelId: 'c1', selectedId: null }));
      // 空频道停在「进行中」，写的是任务从哪儿来。
      expect(selectedTab()).toBe('进行中');
      expect(container.textContent).toContain('你在频道里提到的活会出现在这里。');
      expect(container.querySelector('form')).toBeNull();
      await press('新任务');
      expect(button('谁来做：我来做')).toBeDefined();
      await typeInto(container.querySelector<HTMLInputElement>('form input')!, '录第 12 期口播');
      await press('添加');
      expect(calls('workItems.create')).toEqual([expect.objectContaining({ channelId: 'c1', title: '录第 12 期口播', owner: 'user', start: false })]);
      expect(selectedTab()).toBe('接下来');
      expect(container.querySelector<HTMLInputElement>('form input')?.value).toBe('');
    } finally {
      useWorkItems.setState({ byChannel: {} });
    }
  });

  it('没选过页签时停在第一个有任务的页签，页签上带条数；进行中按子状态分组', async () => {
    const at = '2026-10-30T09:00:00Z';
    const active = (id: string, state: string) =>
      ({ ...resolvedItem(1), id, title: id, status: 'active', resolution: null, active: { state, since: at }, updatedAt: at }) as unknown as WorkItem;
    useWorkItems.setState({ byChannel: { c1: { items: [active('审片', 'needsReview'), active('剪辑', 'working'), resolvedItem(2)], resolvedTail: 20, reports: [] } } });
    try {
      await render(createElement(TaskPanel, { channelId: 'c1', selectedId: null }));
      expect([...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['进行中 2', '接下来', '定时', '已解决']);
      expect(selectedTab()).toBe('进行中 2');
      expect([...container.querySelectorAll('section h3')].map((h) => h.textContent)).toEqual(['待你审阅1', '工作中1']);
    } finally {
      useWorkItems.setState({ byChannel: {} });
    }
  });
});

const AWAY: AwaySummary = {
  since: '2026-10-31T08:00:00Z',
  done: [{ id: 'wi_done', title: '第 11 期字幕', headline: '中英字幕都加好了' }],
  needsYou: [{ id: 'wi_review', title: '竖版短视频', headline: null }],
  stopped: [],
  firstUnreadItemId: 'msg2',
};

function AwayProbe() {
  const away = useAwayAndSeen({ id: 'c1', conversationId: 'conv_c1' });
  return createElement('span', { 'data-testid': 'away' }, away.summary ? `${away.summary.done.length}/${away.firstUnread}` : 'none');
}

describe('你不在时（BOT-BH-08、需求 §11.4）', () => {
  it('人一直停在频道里：切走窗口时记下看到的位置，回到窗口时重取摘要', async () => {
    let summary: AwaySummary = { ...AWAY, done: [], needsYou: [], firstUnreadItemId: null };
    handlers['bot.awaySummary'] = () => summary;
    handlers['channels.markSeen'] = () => ({ channel: {} });
    await render(createElement(AwayProbe));
    expect(calls('bot.awaySummary')).toHaveLength(1);
    expect(document.querySelector('[data-testid="away"]')?.textContent).toBe('none');
    await act(async () => window.dispatchEvent(new Event('blur')));
    expect(calls('channels.markSeen')).toHaveLength(1);
    summary = AWAY;
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(calls('bot.awaySummary')).toHaveLength(2);
    expect(document.querySelector('[data-testid="away"]')?.textContent).toBe('1/msg2');
  });

  it('每件一行结论，点了打开那条任务', async () => {
    const opened: string[] = [];
    await render(createElement(AwayBanner, { summary: AWAY, onOpen: (row: { id: string }) => opened.push(row.id) }));
    const text = container.textContent ?? '';
    expect(text).toContain('你不在时：1 个已完成 · 1 个等你');
    expect(text).toContain('第 11 期字幕：中英字幕都加好了');
    expect(text).toContain('竖版短视频');
    await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('竖版短视频'))!.click());
    expect(opened).toEqual(['wi_review']);
  });

  it('上次看到之后的第一条前面画「以下是新消息」细线', async () => {
    const items: TimelineItem[] = [
      { kind: 'user-message', id: 'msg1', createdAt: '2026-10-31T07:00:00Z', taskId: null, text: '旧的' },
      { kind: 'user-message', id: 'msg2', createdAt: '2026-10-31T09:00:00Z', taskId: null, text: '新的' },
    ] as TimelineItem[];
    const extras = { unread: { itemId: 'msg2', node: createElement('hr', { 'data-testid': 'unread' }) }, userMessage: null, agentMessage: null };
    await render(createElement(BotThreadExtrasContext.Provider, { value: extras }, createElement(Thread, { items, conversationId: 'conv_c1', running: false })));
    const rule = container.querySelector('[data-testid="unread"]');
    expect(rule).not.toBeNull();
    const html = container.innerHTML;
    expect(html.indexOf('旧的')).toBeLessThan(html.indexOf('data-testid="unread"'));
    expect(html.indexOf('data-testid="unread"')).toBeLessThan(html.indexOf('新的'));
  });

  it('智能体的消息不画头像，正文放进气泡（需求 §11.4）；不在 Bot 里时照旧带头像', async () => {
    const items = [{ kind: 'agent-message', id: 'am1', createdAt: '2026-10-31T09:00:00Z', taskId: null, text: '好的，开始剪。' }] as TimelineItem[];
    const extras = { unread: null, userMessage: null, agentMessage: () => null };
    await render(createElement(BotThreadExtrasContext.Provider, { value: extras }, createElement(Thread, { items, conversationId: 'conv_c1', running: false })));
    const row = container.querySelector('[data-role="agent"]')!;
    expect(row.querySelector('[data-bubble]')?.textContent).toContain('好的，开始剪。');
    expect(row.querySelector(':scope > [aria-hidden]')).toBeNull();
    await render(createElement(Thread, { items, conversationId: 'conv_c1', running: false }));
    const plain = container.querySelector('[data-role="agent"]')!;
    expect(plain.querySelector('[data-bubble]')).toBeNull();
    expect(plain.querySelector(':scope > [aria-hidden]')).not.toBeNull();
  });
});

describe('设置里的 Bot 一节（需求 §11.8）', () => {
  it('有 Make 自动触发与补充提示两个开关，切换时只改这一项', async () => {
    useChannels.setState({ ready: true, settings: DEFAULT_BOT_SETTINGS });
    handlers['bot.settings'] = (p) => ({ settings: { ...DEFAULT_BOT_SETTINGS, ...(p.patch as object) } });
    await render(createElement(BotSettings));
    const toggle = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    expect(toggle('Make 自动触发').checked).toBe(true);
    expect(toggle('补充提示').checked).toBe(true);
    await act(async () => toggle('Make 自动触发').click());
    await act(async () => toggle('补充提示').click());
    expect(calls('bot.settings')).toEqual([{ patch: { makeAutoTrigger: false } }, { patch: { supplementHints: false } }]);
    expect(useChannels.getState().settings.supplementHints).toBe(false);
  });
});

describe('线程的提示芯片（BOT-SG-01/02）', () => {
  it('任务详情的输入框上方显示线程最新一条消息下的提示，点了发出完整的句子', async () => {
    handlers['conversations.send'] = () => ({ taskId: 't2' });
    const items = [
      { kind: 'agent-message', id: 'am1', createdAt: '2026-10-31T09:00:00Z', taskId: 't1', text: '要我把第 2 段也剪短吗？', streaming: false },
      {
        kind: 'suggestions',
        id: 'sg1',
        createdAt: '2026-10-31T09:00:01Z',
        taskId: null,
        forItemId: 'am1',
        source: 'system',
        state: 'open',
        usedChipId: null,
        chips: [
          { id: 'ch_yes', label: '是', text: '是', kind: 'confirm', kindTag: null, fillOnly: false, recommended: false, answers: null, target: null, action: null },
          { id: 'ch_no', label: '否', text: '否', kind: 'decline', kindTag: null, fillOnly: false, recommended: false, answers: null, target: null, action: null },
        ],
      },
    ] as TimelineItem[];
    useTimeline.setState({ byConversationId: { conv_thread: { items, offset: 0 } as never } });
    await render(createElement(ThreadChips, { threadId: 'conv_thread' }));
    expect(container.querySelector('[role="group"]')?.textContent).toBe('是否');
    await press('是');
    expect(calls('conversations.send')).toEqual([expect.objectContaining({ conversationId: 'conv_thread', text: '是', via: 'suggestion', suggestionChipId: 'ch_yes' })]);
  });
});

function SuggestionProbe({ item }: { item: WorkItem }) {
  const call = useBotCall();
  return createElement(SuggestionButtons, { item, pending: false, run: async (fn: () => Promise<unknown>) => void (await fn()), call });
}

const SUGGESTED = {
  id: 'wi_s',
  channelId: 'c1',
  title: '给第 12 期加字幕',
  owner: 'agent',
  status: 'suggested',
  suggestion: {
    reason: '还没有字幕',
    owner: 'agent',
    evidence: [
      { kind: 'video', projectId: 'p1', videoId: 'v12' },
      { kind: 'file', path: '/work/notes/brief.txt' },
    ],
    trigger: 'manual',
    kindTag: 'add-captions',
    subjectKey: 'k',
    expiresAt: '2026-11-14T00:00:00Z',
  },
} as unknown as WorkItem;

describe('建议卡（BOT-MK-04）', () => {
  it('归属可切成我来做（这时没有「现在做」），采纳前可改标题，改动随采纳一起交出', async () => {
    handlers['workItems.transition'] = () => ({ item: SUGGESTED });
    await render(createElement(SuggestionProbe, { item: SUGGESTED }));
    expect(button('现在做')).toBeDefined();
    await press('我来做');
    expect(button('现在做')).toBeUndefined();
    await press('改标题');
    const field = container.querySelector<HTMLInputElement>('input')!;
    expect(field.value).toBe('给第 12 期加字幕');
    await typeInto(field, '给第 12 期加中英字幕');
    await press('加入');
    expect(calls('workItems.transition')).toEqual([
      { id: 'wi_s', event: { type: 'accept', start: false, owner: 'user', title: '给第 12 期加中英字幕' } },
    ]);
  });

  it('默认交给智能体；没改标题时不带 title', async () => {
    handlers['workItems.transition'] = () => ({ item: SUGGESTED });
    await render(createElement(SuggestionProbe, { item: SUGGESTED }));
    await press('现在做');
    expect(calls('workItems.transition')).toEqual([{ id: 'wi_s', event: { type: 'accept', start: true, owner: 'agent' } }]);
  });

  it('依据链接：视频在编辑器里打开，文件只写名字', async () => {
    const openVideo = vi.fn();
    const shell = useShell.getState().openVideo;
    useShell.setState({ openVideo });
    useSpace.setState({
      entries: [
        {
          id: 'e12',
          kind: 'video',
          name: '第 12 期',
          fileName: 'ep12.baocut',
          source: { projectId: 'p1', conversationId: null },
          relPath: 'ep12.baocut',
          user: { favorite: false, displayName: null, trashedAt: null },
          ref: { videoId: 'v12' },
        } as unknown as SpaceEntry,
      ],
    });
    try {
      await render(createElement(SuggestionProbe, { item: SUGGESTED }));
      const text = container.textContent ?? '';
      expect(text).toContain('依据');
      expect(text).toContain('文件 · brief.txt');
      await press('视频 · 第 12 期');
      expect(openVideo).toHaveBeenCalledWith({ projectId: 'p1', path: 'ep12.baocut' });
    } finally {
      useShell.setState({ openVideo: shell });
      useSpace.setState({ entries: [] });
    }
  });
});

describe('建立频道卡的「修改」（需求 §11.4）', () => {
  it('改名字后再建立：改过的字段随 edits 交给 Runtime', async () => {
    handlers['bot.proposals.respond'] = () => ({ resultId: 'c2' });
    const item = {
      kind: 'proposal',
      id: 'pr1',
      createdAt: '2026-10-31T09:00:00Z',
      taskId: null,
      proposal: { type: 'channel', name: '剪辑', purpose: '剪第 12 期', templateId: null },
      status: 'pending',
      resultId: null,
    } as unknown as Extract<TimelineItem, { kind: 'proposal' }>;
    await render(createElement(ProposalCard, { item, conversationId: 'conv_main', channelId: null }));
    await press('修改');
    const name = container.querySelector<HTMLInputElement>('input')!;
    expect(name.value).toBe('剪辑');
    await typeInto(name, '第 12 期剪辑');
    await press('建立');
    expect(calls('bot.proposals.respond')).toEqual([{ conversationId: 'conv_main', itemId: 'pr1', accept: true, edits: { name: '第 12 期剪辑' } }]);
  });
});

const RUNNING = {
  id: 'wi_run',
  channelId: 'c1',
  title: '第 12 期字幕改成黄色',
  owner: 'agent',
  status: 'active',
  active: { state: 'working' },
  threadId: 'conv_thread',
  outputs: [{ kind: 'video', projectId: 'p1', videoId: 'v12', label: '第 12 期', version: null }],
  resources: [],
  baseVersions: [],
} as unknown as WorkItem;

describe('撤销与删除记录（BOT-EX-19、BOT-EX-20）', () => {
  it('进行中的任务也能删除记录：菜单里有，对话框写明先停线程', async () => {
    expect(menuActions(RUNNING)).toContain('deleteRecord');
    expect(menuActions({ ...RUNNING, status: 'upNext', active: null } as unknown as WorkItem)).toContain('deleteRecord');
    handlers['workItems.deleteRecord'] = () => ({ files: ['notes/a.txt'], keptShared: [], deleted: false });
    await render(createElement(DeleteRecordDialog, { item: RUNNING, onClose: () => {}, onDeleted: () => {} }));
    expect(document.body.textContent).toContain('这条任务还在进行，会先停下它的线程。');
    expect(document.body.textContent).toContain('notes/a.txt');
  });

  it('整体撤销列出你在每部视频里改了什么，同名操作合计次数', async () => {
    handlers['workItems.revertAll'] = () => ({
      plan: {
        videos: [
          {
            projectId: 'p1',
            videoId: 'v12',
            baseVersion: 3,
            userEdits: [
              { version: 4, at: '2026-10-31T09:00:00Z', changes: [{ label: '改字幕', count: 1 }] },
              { version: 6, at: '2026-10-31T10:00:00Z', changes: [{ label: '改字幕', count: 1 }, { label: '删除片段', count: 1 }] },
            ],
            agentOnlyPossible: false,
            reason: 'video v12 has your own edits since version 3',
          },
        ],
      },
    });
    await render(createElement(RevertDialog, { item: RUNNING, onClose: () => {} }));
    const text = document.body.textContent ?? '';
    expect(text).toContain('第 12 期：之后你改过 2 次');
    expect(text).toContain('改字幕（2 次）');
    expect(text).toContain('删除片段');
  });
});

describe('任务详情可改（BOT-TK-06）', () => {
  const item = { ...RUNNING, priority: 'medium', dueOn: null, eventOn: null } as unknown as WorkItem;

  it('改标题、优先级与截止日，只交改过的字段', async () => {
    handlers['workItems.update'] = (p) => ({ item: { ...item, ...(p.patch as object) } });
    await render(createElement(TaskEditDialog, { item, onClose: () => {} }));
    const fields = [...document.querySelectorAll<HTMLInputElement>('input[type="text"], input:not([type])')];
    expect(fields.map((f) => f.value)).toEqual(['第 12 期字幕改成黄色', '', '']);
    await typeInto(fields[0]!, '第 12 期字幕改成白色');
    await typeInto(fields[1]!, '2026-11-07');
    await press('保存');
    expect(calls('workItems.update')).toEqual([{ id: 'wi_run', patch: { title: '第 12 期字幕改成白色', dueOn: '2026-11-07' } }]);
  });

  it('日期写错时不能保存', async () => {
    await render(createElement(TaskEditDialog, { item, onClose: () => {} }));
    const fields = [...document.querySelectorAll<HTMLInputElement>('input[type="text"], input:not([type])')];
    await typeInto(fields[2]!, '2026-02-30');
    expect(button('保存')?.disabled || button('保存')?.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('截止日旁写明是谁定的', () => {
    expect(dateFact('截止', '2026-11-07', 'user')).toMatch(/· 你定的$/);
    expect(dateFact('截止', '2026-11-07', 'agent')).toMatch(/· 来自你的消息$/);
    expect(dateFact('截止', '2026-11-07', undefined)).not.toContain('·');
  });

  it('资源与产物写出是哪个：没名字的文件用文件名（BOT-TK-06）', () => {
    expect(resourceLabel({ kind: 'file', path: 'drafts/outline.md' })).toBe('文件 · outline.md');
    expect(resourceLabel({ kind: 'file', path: 'C:\\clips\\take 2.mov' })).toBe('文件 · take 2.mov');
    expect(resourceLabel({ kind: 'file', path: 'script.md', label: '旁白稿', version: null })).toBe('文件 · 旁白稿');
    expect(resourceLabel({ kind: 'video', projectId: 'p1', videoId: 'v1' })).toBe('视频');
  });
});

describe('任务的产物与资源卡（BOT-VE-03、需求 §11.6）', () => {
  const user = { favorite: false, displayName: null, trashedAt: null };
  const VIDEO = {
    id: 'e12',
    kind: 'video',
    name: '第 12 期',
    fileName: 'ep12.baocut',
    source: { projectId: 'p1', conversationId: null },
    relPath: 'ep12.baocut',
    user,
    ref: { videoId: 'v12' },
    media: { durationSec: 65 },
    status: null,
    size: 0,
    lastActivityAt: '2026-10-31T09:00:00Z',
  } as unknown as SpaceEntry;
  const EXPORT = {
    id: 'e_mp4',
    kind: 'export',
    name: 'ep12-final.mp4',
    fileName: 'ep12-final.mp4',
    source: { projectId: 'p1', conversationId: null },
    relPath: 'exports/ep12-final.mp4',
    user,
    ref: null,
    status: null,
    size: 12_000_000,
    lastActivityAt: '2026-10-31T09:00:00Z',
  } as unknown as SpaceEntry;
  const dirs = { projects: [{ id: 'p1', path: '/Users/me/Shows' }], conversations: [{ id: 'conv_thread', cwd: '/Users/me/BaoCut/channels/c1' }] };

  it('视频对到 Space 条目：名字、时长与打开的位置；片段写出起止；文件按位置找到条目', () => {
    const entries = [VIDEO, EXPORT];
    expect(refOutput({ kind: 'video', projectId: 'p1', videoId: 'v12' }, entries, dirs, 'conv_thread', '视频')).toMatchObject({
      id: 'v12',
      kind: 'video',
      name: '第 12 期',
      durationSeconds: 65,
      entry: VIDEO,
      video: { projectId: 'p1', path: 'ep12.baocut' },
    });
    const range = refOutput({ kind: 'video-range', projectId: 'p1', videoId: 'v12', startMs: 12_000, endMs: 30_500 }, entries, dirs, 'conv_thread', '视频');
    expect(range?.name).toBe('第 12 期 · 0:12–0:30');
    // Space 里还没有：卡照画，打开置灰。
    expect(refOutput({ kind: 'video', projectId: 'p1', videoId: 'v_new' }, entries, dirs, 'conv_thread', '视频')).toMatchObject({ name: '视频', video: null, entry: null });
    // 导出到项目目录里的成片：绝对路径相对项目，对上 Space 条目。
    expect(refOutput({ kind: 'file', path: '/Users/me/Shows/exports/ep12-final.mp4', label: '成片', version: null }, entries, dirs, 'conv_thread', '视频')).toMatchObject({
      kind: 'export',
      name: '成片',
      entry: EXPORT,
      file: { target: { projectId: 'p1', path: 'exports/ep12-final.mp4' } },
    });
    // 频道文件目录里生成的素材：相对路径落在线程会话的工作目录。
    expect(refOutput({ kind: 'file', path: './covers/cover.png' }, entries, dirs, 'conv_thread', '视频')).toMatchObject({
      kind: 'image',
      name: 'cover.png',
      entry: null,
      file: { target: { conversationId: 'conv_thread', path: 'covers/cover.png' } },
    });
    expect(refOutput({ kind: 'space', entryId: 'e_mp4' }, entries, dirs, 'conv_thread', '视频')).toMatchObject({ entry: EXPORT, file: { target: { entryId: 'e_mp4' } } });
    expect(refOutput({ kind: 'message', conversationId: 'conv_c1', itemId: 'm1' }, entries, dirs, 'conv_thread', '视频')).toBeNull();
  });

  it('文件的位置：频道目录里的绝对路径相对线程会话，盘符路径不分大小写，哪里都不在时交给会话', () => {
    expect(fileRefTarget('/Users/me/BaoCut/channels/c1/notes.md', [], dirs, 'conv_thread')).toEqual({ conversationId: 'conv_thread', path: 'notes.md' });
    expect(fileRefTarget('C:\\Shows\\out\\a.mp4', [], { projects: [{ id: 'p2', path: 'c:\\shows' }], conversations: [] }, null)).toEqual({ projectId: 'p2', path: 'out/a.mp4' });
    expect(fileRefTarget('/tmp/elsewhere.mp4', [], dirs, 'conv_thread')).toEqual({ conversationId: 'conv_thread', path: '/tmp/elsewhere.mp4' });
    expect(fileRefTarget('/tmp/elsewhere.mp4', [], dirs, null)).toBeNull();
  });

  it('详情里画成卡：视频有缩略图、时长与状态，「打开编辑器」在功能区打开；文件卡在单文件标签里打开；画不了的写一行字', async () => {
    const shell = useShell.getState();
    const openVideo = vi.fn();
    const openPane = vi.fn();
    useShell.setState({ openVideo, openPane });
    useSpace.setState({ entries: [VIDEO, EXPORT], ready: true, scanning: false, issues: [] });
    useDirectory.setState({ projects: [{ id: 'p1', name: 'Shows', path: '/Users/me/Shows' }] as never, conversations: [] });
    const transcribing = {
      jobId: 'job_t',
      kind: 'transcribe',
      state: 'running',
      videoId: 'v12',
      progress: null,
      submitter: { kind: 'user', id: null, taskId: null },
      createdAt: '2026-10-31T09:00:00Z',
      updatedAt: '2026-10-31T09:00:00Z',
    } as unknown as JobRecord;
    useJobs.setState({ jobs: [transcribing] });
    Object.assign(runtime, {
      spaceThumbnails: { retain: () => () => {}, subscribe: () => () => {}, version: () => 0, peek: () => ({ kind: 'image', url: 'blob:poster', width: 640, height: 360 }) },
      videos: { media: { subscribe: () => () => {}, version: () => 0, thumbnail: () => null } },
    });
    const item = {
      ...RUNNING,
      outputs: [
        { kind: 'video', projectId: 'p1', videoId: 'v12', label: '第 12 期 · 黄色字幕', version: null },
        { kind: 'file', path: '/Users/me/Shows/exports/ep12-final.mp4', label: '成片 MP4', version: null },
      ],
      resources: [
        { kind: 'video-range', projectId: 'p1', videoId: 'v12', startMs: 12_000, endMs: 30_000 },
        { kind: 'message', conversationId: 'conv_c1', itemId: 'm1' },
      ],
    } as unknown as WorkItem;
    try {
      await render(createElement(TaskRefs, { refs: item.outputs, item }));
      expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:poster');
      const text = container.textContent ?? '';
      expect(text).toContain('第 12 期 · 黄色字幕');
      expect(text).toContain('1:05');
      expect(text).toContain('转录中');
      await press('打开编辑器');
      expect(openVideo).toHaveBeenCalledWith({ projectId: 'p1', path: 'ep12.baocut' });
      const file = [...container.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.startsWith('成片 MP4'));
      await act(async () => file!.click());
      expect(openPane).toHaveBeenCalledWith({ kind: 'file', target: { projectId: 'p1', path: 'exports/ep12-final.mp4' } });

      await render(createElement(TaskRefs, { refs: item.resources, item }));
      expect(container.textContent).toContain('第 12 期 · 0:12–0:30');
      expect(container.textContent).toContain('消息');
      await press('打开编辑器');
      expect(useEditor.getState().videoId).toBe('v12');
      expect(useEditor.getState().playhead).toBe(12);
      expect(openVideo).toHaveBeenLastCalledWith({ projectId: 'p1', path: 'ep12.baocut' });
    } finally {
      useShell.setState({ openVideo: shell.openVideo, openPane: shell.openPane });
      useSpace.setState({ entries: [], ready: false, scanning: true, issues: [] });
      useDirectory.setState({ projects: [], conversations: [] });
      useJobs.setState({ jobs: [] });
    }
  });
});

function resolvedItem(n: number): WorkItem {
  const at = `2026-10-${String(30 - n).padStart(2, '0')}T09:00:00Z`;
  return {
    id: `wi_r${n}`,
    channelId: 'c1',
    title: `第 ${n} 期`,
    owner: 'agent',
    status: 'resolved',
    priority: 'medium',
    resolution: { kind: 'done', by: 'user', at, evidence: null, confirmedBy: null, mergedInto: null },
    updatedAt: at,
    dueOn: null,
    question: null,
    steps: [],
    active: null,
  } as unknown as WorkItem;
}

describe('任务面板的已完成段（I19）', () => {
  it('快照里已解决的到了上限：给「显示更早的」，取回 Runtime 的全部已解决任务补进来', async () => {
    useWorkItems.setState({ byChannel: { c1: { items: [resolvedItem(1), resolvedItem(2)], resolvedTail: 2, reports: [] } } });
    handlers['workItems.list'] = () => ({ items: [resolvedItem(1), resolvedItem(2), resolvedItem(3)] });
    try {
      await render(createElement(TaskPanel, { channelId: 'c1', selectedId: null }));
      expect(container.textContent).not.toContain('第 3 期');
      await press('显示更早的');
      expect(calls('workItems.list')).toEqual([{ channelId: 'c1', status: 'resolved' }]);
      expect(container.textContent).toContain('第 3 期');
      expect(button('显示更早的')).toBeUndefined();
    } finally {
      useWorkItems.setState({ byChannel: {} });
    }
  });

  it('按频道保存的状态（回复目标等）换了频道就回到初始值，换回来也不带旧值', async () => {
    let setReply: (next: string | null) => void = () => {};
    function Probe({ channelId }: { channelId: string }) {
      const [replyTo, set] = useScopedState<string | null>(channelId, null);
      setReply = set;
      return createElement('span', null, replyTo ?? '无');
    }
    await render(createElement(Probe, { channelId: 'A' }));
    await act(async () => setReply('card1'));
    expect(container.textContent).toBe('card1');
    await render(createElement(Probe, { channelId: 'B' }));
    expect(container.textContent).toBe('无');
    await render(createElement(Probe, { channelId: 'A' }));
    expect(container.textContent).toBe('无');
  });

  it('切到别的频道：「显示更早的」照常出现，不沿用上一个频道已经点开的状态', async () => {
    useWorkItems.setState({
      byChannel: {
        c1: { items: [resolvedItem(1), resolvedItem(2)], resolvedTail: 2, reports: [] },
        c2: { items: [resolvedItem(4), resolvedItem(5)], resolvedTail: 2, reports: [] },
      },
    });
    handlers['workItems.list'] = () => ({ items: [resolvedItem(1), resolvedItem(2), resolvedItem(3)] });
    try {
      await render(createElement(TaskPanel, { channelId: 'c1', selectedId: null }));
      await press('显示更早的');
      expect(button('显示更早的')).toBeUndefined();
      await render(createElement(TaskPanel, { channelId: 'c2', selectedId: null }));
      expect(button('显示更早的')).toBeDefined();
    } finally {
      useWorkItems.setState({ byChannel: {} });
    }
  });

  it('没到上限时不给，也不去取', async () => {
    useWorkItems.setState({ byChannel: { c1: { items: [resolvedItem(1)], resolvedTail: 2, reports: [] } } });
    try {
      await render(createElement(TaskPanel, { channelId: 'c1', selectedId: null }));
      expect(button('显示更早的')).toBeUndefined();
      expect(calls('workItems.list')).toEqual([]);
    } finally {
      useWorkItems.setState({ byChannel: {} });
    }
  });
});

describe('频道花费（I16、BOT-NF-04）', () => {
  it('频道头部写今天与本月的花费；这个月没花钱时不写', async () => {
    const summary = (month: string) => ({
      channel: { id: 'c1' },
      spend: { today: { amount: '0.42', currency: 'USD' }, month: { amount: month, currency: 'USD' } },
    });
    useChannels.setState({ channels: [summary('3.10')] as never });
    await render(createElement(ChannelSpend, { channelId: 'c1' }));
    expect(container.textContent).toBe('今天花了 $0.42 · 本月 $3.10');
    useChannels.setState({ channels: [summary('0')] as never });
    await render(createElement(ChannelSpend, { channelId: 'c1' }));
    expect(container.textContent).toBe('');
    useChannels.setState({ channels: [] });
  });
});

describe('任务的花费（BOT-NF-04）', () => {
  it('任务卡写这项任务累计花了多少；没花过的不写', async () => {
    useChannels.setState({
      channels: [{ channel: { id: 'c1' }, spend: { today: null, month: { amount: '1.25', currency: 'USD' }, tasks: { wi_r1: { amount: '1.25', currency: 'USD' } } } }] as never,
    });
    useWorkItems.setState({ byChannel: { c1: { items: [resolvedItem(1), resolvedItem(2)], resolvedTail: 20, reports: [] } } });
    try {
      await render(createElement(TaskPanel, { channelId: 'c1', selectedId: null }));
      const rows = [...container.querySelectorAll('li')];
      expect(rows.find((r) => r.textContent?.includes('第 1 期'))?.textContent).toContain('已花 $1.25');
      expect(rows.find((r) => r.textContent?.includes('第 2 期'))?.textContent).not.toContain('已花');
    } finally {
      useWorkItems.setState({ byChannel: {} });
      useChannels.setState({ channels: [] });
    }
  });
});

describe('周期任务建到频道里（Bot 技术方案 §14.1）', () => {
  it('从频道头部打开：目标默认这个频道，建立时交频道对话与任务模板', async () => {
    useChannels.setState({ channels: [{ channel: { id: 'c1', name: '剪辑', conversationId: 'conv_c1', archived: false } }] as never });
    const createSchedule = vi.fn(async (params: { name?: string }) => ({ schedule: { id: 's1', name: params.name || '每周一整理评论', cadence: { type: 'daily', time: '09:00' } } }));
    Object.assign(runtime, { createSchedule });
    try {
      await render(createElement(DialogContainer, { onDismiss: () => {}, children: createElement(ScheduleDialog, { channelId: 'c1', onClose: () => {} }) }));
      const radio = document.querySelector<HTMLInputElement>('input[type="radio"][value="work-item"]')!;
      expect(radio.checked).toBe(true);
      const prompt = document.querySelector<HTMLTextAreaElement>('textarea')!;
      await typeInto(prompt, '每周一整理评论\n挑出要回复的');
      await press('建立');
      expect(createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv_c1',
          target: 'work-item',
          workItem: { channelId: 'c1', template: { title: '每周一整理评论', description: '', owner: 'agent', prompt: '每周一整理评论\n挑出要回复的', resources: [] } },
        }),
      );
    } finally {
      useChannels.setState({ channels: [] });
    }
  });

  it('编辑频道任务的周期任务：目标固定，不交 target', async () => {
    useChannels.setState({ channels: [{ channel: { id: 'c1', name: '剪辑', conversationId: 'conv_c1', archived: false } }] as never });
    const updateSchedule = vi.fn(async (_params: Record<string, unknown>) => {});
    Object.assign(runtime, { updateSchedule });
    const schedule = {
      id: 's1',
      name: '整理评论',
      prompt: '每周一整理评论',
      cadence: { type: 'daily', time: '09:00' },
      conversationId: 'conv_c1',
      target: 'work-item',
      projectId: null,
      agent: { driverId: 'claude', model: null, effort: null, accessMode: null },
      maxRuns: null,
      workItem: { channelId: 'c1', template: { title: '整理评论', description: '', owner: 'agent', prompt: '每周一整理评论', resources: [] } },
    };
    try {
      await render(createElement(DialogContainer, { onDismiss: () => {}, children: createElement(ScheduleDialog, { schedule: schedule as never, onClose: () => {} }) }));
      expect(document.querySelector('input[type="radio"]')).toBeNull();
      expect(document.body.textContent).toContain('每次在频道「剪辑」里建一条任务');
      await press('保存');
      expect(updateSchedule).toHaveBeenCalledTimes(1);
      expect(updateSchedule.mock.calls[0]![0]).not.toHaveProperty('target');
    } finally {
      useChannels.setState({ channels: [] });
    }
  });

  it('从 Make 模板打开：名字、指令与频率填好，目标是这个频道，确认才建（BOT-MK-05）', async () => {
    useChannels.setState({ channels: [{ channel: { id: 'c1', name: '剪辑', conversationId: 'conv_c1', archived: false } }] as never });
    const createSchedule = vi.fn(async (params: { name?: string }) => ({ schedule: { id: 's1', name: params.name, cadence: { type: 'daily', time: '08:00' } } }));
    Object.assign(runtime, { createSchedule });
    const initial = { name: '每日素材整理', prompt: '整理关注的文件夹里新进的文件，按视频归好。', cadence: { type: 'daily' as const, time: '08:00' } };
    try {
      await render(createElement(DialogContainer, { onDismiss: () => {}, children: createElement(ScheduleDialog, { channelId: 'c1', initial, onClose: () => {} }) }));
      expect(document.querySelector<HTMLInputElement>('input[type="radio"][value="work-item"]')!.checked).toBe(true);
      expect(document.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(initial.prompt);
      expect(createSchedule).not.toHaveBeenCalled();
      await press('建立');
      expect(createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ name: '每日素材整理', cadence: initial.cadence, conversationId: 'conv_c1', target: 'work-item' }),
      );
    } finally {
      useChannels.setState({ channels: [] });
    }
  });
});

describe('Make 面板（BOT-MK-01、04、05，需求 §11.11）', () => {
  const suggestion = (id: string, title: string, owner: 'agent' | 'user', updatedAt: string, kindTag: string) =>
    ({
      ...resolvedItem(1),
      id,
      title,
      owner,
      status: 'suggested',
      resolution: null,
      outputs: [],
      updatedAt,
      suggestion: { reason: '还没有字幕', owner, evidence: [], trigger: 'manual', kindTag, subjectKey: id, expiresAt: '2026-11-14T00:00:00Z' },
    }) as unknown as WorkItem;
  const items = [
    suggestion('wi_a', '切三条竖版', 'agent', '2026-10-31T03:00:00Z', 'derive-shorts'),
    suggestion('wi_b', '补字幕', 'agent', '2026-10-31T02:00:00Z', 'add-captions'),
    suggestion('wi_c', '自己录口播', 'user', '2026-10-31T01:00:00Z', 'tidy'),
  ];
  const rowOf = (title: string) => [...container.querySelectorAll('li')].find((li) => li.textContent?.includes(title))!;

  beforeEach(() => {
    useChannels.setState({ ready: true, channels: [{ channel: { id: 'c1', name: '剪辑', conversationId: 'conv_c1', archived: false } }] as never });
    useWorkItems.setState({ byChannel: { c1: { items, resolvedTail: 20, reports: [] } } });
    handlers['workItems.transition'] = (p) => ({ item: items.find((i) => i.id === p.id) });
  });
  afterEach(() => {
    useWorkItems.setState({ byChannel: {} });
    useChannels.setState({ channels: [] });
  });

  const panel = () => createElement(MakePanel, { channelId: 'c1', scope: 'channel', onScope: () => {} });

  it('第一条是带预览的大卡，右上角 ✕ 忽略；还没有产物时写明会出现什么', async () => {
    await render(panel());
    const hero = container.querySelector('section[aria-label="建议：切三条竖版"]')!;
    expect(hero.textContent).toContain('竖版短视频');
    expect([...hero.querySelectorAll('button')].some((b) => b.textContent?.trim() === '忽略')).toBe(false);
    await press('忽略「切三条竖版」');
    expect(calls('workItems.transition')).toEqual([{ id: 'wi_a', event: { type: 'dismiss' } }]);
    expect(container.textContent).toContain('任务做出来的视频、字幕和文档会出现在这里。');
  });

  it('其余一行一条：「现在做」按建议的归属开工，我来做的建议行尾不给「现在做」，点标题展开完整处理', async () => {
    await render(panel());
    expect(rowOf('自己录口播').textContent).not.toContain('现在做');
    const doNow = [...rowOf('补字幕').querySelectorAll('button')].find((b) => b.textContent?.trim() === '现在做')!;
    await act(async () => doNow.click());
    expect(calls('workItems.transition')).toEqual([{ id: 'wi_b', event: { type: 'accept', start: true, owner: 'agent' } }]);
    const title = rowOf('自己录口播').querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    await act(async () => title.click());
    expect(title.getAttribute('aria-expanded')).toBe('true');
    expect(rowOf('自己录口播').querySelector('[aria-label="改标题"]')).not.toBeNull();
  });

  it('「给点建议」交给这个频道；没有新建议时说一声', async () => {
    handlers['bot.make.run'] = () => ({ runId: 'r1', shown: 0 });
    const toast = vi.spyOn(ToastQueue, 'neutral').mockImplementation(() => () => {});
    try {
      await render(panel());
      await press('给点建议');
      await act(async () => {});
      expect(calls('bot.make.run')).toEqual([{ channelId: 'c1' }]);
      expect(toast).toHaveBeenCalledWith('现在没有新的建议', expect.anything());
    } finally {
      toast.mockRestore();
    }
  });

  it('模板「＋」打开周期任务对话框，填好名字与指令', async () => {
    await render(panel());
    await press('建立「每日素材整理」');
    expect(document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')?.value).toBe('整理关注的文件夹里新进的文件，按视频归好。');
  });
});

describe('改已发的消息与表情回应（BOT-EX-06、BOT-EX-10）', () => {
  const typed = { kind: 'user-message', id: 'msg1', createdAt: '2026-10-31T09:00:00Z', taskId: null, text: '剪 3 条' } as Extract<TimelineItem, { kind: 'user-message' }>;

  it('亲手打的消息可以改：交 conversations.editMessage；改过的标「已编辑」', async () => {
    handlers['conversations.editMessage'] = (p) => ({ item: { ...typed, text: p.text } });
    await render(createElement(UserMessageExtras, { item: typed, conversationId: 'conv_c1' }));
    expect(container.textContent).not.toContain('已编辑');
    await press('编辑消息');
    const field = document.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(field.value).toBe('剪 3 条');
    await typeInto(field, '剪 5 条');
    await press('保存');
    expect(calls('conversations.editMessage')).toEqual([{ conversationId: 'conv_c1', itemId: 'msg1', text: '剪 5 条' }]);

    await render(createElement(UserMessageExtras, { item: { ...typed, text: '剪 5 条', history: [{ text: '剪 3 条', editedAt: '2026-10-31T09:01:00Z' }] }, conversationId: 'conv_c1' }));
    expect(container.textContent).toContain('已编辑');
  });

  it('点提示、点表情发的消息不能改', async () => {
    await render(createElement(UserMessageExtras, { item: { ...typed, via: 'suggestion' }, conversationId: 'conv_c1' }));
    expect(button('编辑消息')).toBeUndefined();
  });

  it('智能体的消息下 👍 👎 交 bot.react；点过的高亮且不再重复', async () => {
    handlers['bot.react'] = () => ({ taskId: 't1' });
    const agent = { kind: 'agent-message', id: 'am1', createdAt: '2026-10-31T09:00:00Z', taskId: 't0', text: '要我把第 2 段也剪短吗？', streaming: false } as Extract<TimelineItem, { kind: 'agent-message' }>;
    await render(createElement(Reactions, { item: agent, conversationId: 'conv_c1' }));
    const up = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.startsWith('赞'))!;
    await act(async () => up.click());
    expect(calls('bot.react')).toEqual([{ conversationId: 'conv_c1', itemId: 'am1', emoji: '\u{1F44D}' }]);

    await render(createElement(Reactions, { item: { ...agent, reactions: ['\u{1F44D}'] }, conversationId: 'conv_c1' }));
    const pressed = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.startsWith('赞'))!;
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
    // 回应过了另一个也不能再点：不然协调者先后收到相反的两个回答。
    const down = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') && !b.getAttribute('aria-label')!.startsWith('赞'))!;
    expect(down.disabled || down.getAttribute('aria-disabled') === 'true').toBe(true);
  });
});

describe('回复线程卡（BOT-EX-09）', () => {
  const task = { ...RUNNING, title: '第 12 期字幕', steps: [], question: null } as unknown as WorkItem;

  it('频道里的线程卡有「回复」；输入框上方写明回复哪条，可取消；发出的消息标「回复：任务名」', async () => {
    useWorkItems.setState({ byChannel: { c1: { items: [task], resolvedTail: 20, reports: [] } } });
    useTimeline.setState({ byConversationId: { conv_c1: { items: [{ kind: 'work-item-ref', id: 'card1', createdAt: '2026-10-31T09:00:00Z', taskId: null, workItemId: 'wi_run' }], offset: 0 } as never } });
    try {
      const replies: string[] = [];
      await render(createElement(WorkItemRefCard, { workItemId: 'wi_run', channelId: 'c1', onReply: () => replies.push('card1') }));
      await press('回复');
      expect(replies).toEqual(['card1']);

      let cancelled = false;
      await render(createElement(ReplyTarget, { workItemId: 'wi_run', onCancel: () => (cancelled = true) }));
      expect(container.textContent).toContain('回复「第 12 期字幕」');
      await press('不回复这条任务');
      expect(cancelled).toBe(true);

      const sent = { kind: 'user-message', id: 'msg9', createdAt: '2026-10-31T09:05:00Z', taskId: null, text: '加上英文', replyToItemId: 'card1' } as Extract<TimelineItem, { kind: 'user-message' }>;
      await render(createElement(UserMessageExtras, { item: sent, conversationId: 'conv_c1' }));
      expect(container.textContent).toContain('回复「第 12 期字幕」');
    } finally {
      useWorkItems.setState({ byChannel: {} });
      useTimeline.setState({ byConversationId: {} });
    }
  });

  it('没有回复入口时卡片上不给「回复」', async () => {
    useWorkItems.setState({ byChannel: { c1: { items: [task], resolvedTail: 20, reports: [] } } });
    try {
      await render(createElement(WorkItemRefCard, { workItemId: 'wi_run', channelId: 'c1' }));
      expect(button('回复')).toBeUndefined();
    } finally {
      useWorkItems.setState({ byChannel: {} });
    }
  });

  it('排队的回复：到时候带 replyToItemId 发出，不插进正在跑的回合', async () => {
    const send = vi.fn(async () => 't9');
    const steer = vi.fn(async () => 'steered');
    Object.assign(runtime, { send, steer });
    const queued = { id: 'q1', text: '加上英文', attachments: [], replyToItemId: 'card1', queuedAt: '2026-10-31T09:05:00Z' };
    useShell.getState().setQueue('conv_c1', () => [queued]);
    expect(await sendQueuedMessageNow(runtime, 'conv_c1', 'q1')).toEqual({ status: 'sent' });
    expect(steer).not.toHaveBeenCalled();
    expect(send.mock.calls[0]).toEqual(['conv_c1', '加上英文', undefined, [], undefined, undefined, undefined, undefined, undefined, undefined, undefined, { replyToItemId: 'card1' }]);
    useShell.getState().setQueue('conv_c1', () => [queued]);
    await drainQueue(runtime, 'conv_c1');
    expect(send.mock.calls[1]!.at(-1)).toEqual({ replyToItemId: 'card1' });
  });
});

describe('导出频道（BOT-CH-13）', () => {
  it('频道设置里「导出…」：选文件夹后交 channels.export', async () => {
    const channel = {
      id: 'c1',
      kind: 'custom',
      name: '剪辑',
      purpose: '',
      conversationId: 'conv_c1',
      archived: false,
      driverId: null,
      model: null,
      effort: null,
      defaultAccessMode: null,
      maxAccessMode: null,
      outputLanguage: null,
      muted: false,
      private: false,
      stallMinutes: null,
      limits: { concurrentThreads: 3, dailyBudget: null, monthlyBudget: null },
    };
    useChannels.setState({ channels: [{ channel, unread: false, counts: {}, lastActivityAt: '2026-10-31T09:00:00Z', spend: null }] as never });
    const pickDirectory = vi.fn(async () => '/Users/me/Exports');
    Object.assign(runtime, { host: { pickDirectory, revealPath: vi.fn(async () => {}) } });
    handlers['channels.export'] = () => ({ path: '/Users/me/Exports/剪辑-c1' });
    try {
      await render(createElement(ChannelSettingsDialog, { channelId: 'c1', onClose: () => {} }));
      await press('导出…');
      expect(pickDirectory).toHaveBeenCalledTimes(1);
      expect(calls('channels.export')).toEqual([{ id: 'c1', dir: '/Users/me/Exports' }]);
    } finally {
      useChannels.setState({ channels: [] });
    }
  });
});

describe('频道记忆页', () => {
  it('保存还没回来时接着打的字不会被存下的旧内容盖掉，仍算没保存的修改', async () => {
    let finish: (v: { version: number }) => void = () => {};
    handlers['channels.readMemory'] = () => ({ content: '## Rules\n', version: 1 });
    handlers['channels.writeMemory'] = () => new Promise((resolve) => (finish = resolve));
    await render(createElement(ChannelMemoryPage, { channel: { id: 'c1', name: '剪辑' } as never }));
    const field = document.querySelector('textarea')!;
    await typeInto(field, '## Rules\n- 字幕用白色\n');
    await press('保存');
    await typeInto(field, '## Rules\n- 字幕用白色\n- 片头 5 秒\n');
    await act(async () => finish({ version: 2 }));
    expect(calls('channels.writeMemory')).toEqual([{ id: 'c1', content: '## Rules\n- 字幕用白色\n', ifVersion: 1 }]);
    expect(document.querySelector('textarea')!.value).toBe('## Rules\n- 字幕用白色\n- 片头 5 秒\n');
    expect(button('放弃修改')!.disabled || button('放弃修改')!.getAttribute('aria-disabled') === 'true').toBe(false);
  });
});
