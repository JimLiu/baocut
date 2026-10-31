// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeContext } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import type { AwaySummary, TimelineItem } from '@baocut/protocol';
import { BotThreadExtrasContext } from '../thread/bot-items.ts';
import { Thread } from '../thread/thread.tsx';
import { AwayBanner, useAwayAndSeen } from './channel-view.tsx';
import { NewTaskDialog } from './task-panel.tsx';
import { DeleteRecordDialog, RevertDialog, ThreadChips, dateFact, menuActions } from './task-detail.tsx';
import { TaskEditDialog } from './task-edit-dialog.tsx';
import { useTimeline } from '../../state/timeline-store.ts';
import { BotSettings } from '../settings/bot-settings.tsx';
import { useChannels } from '../../state/channels-store.ts';
import { DEFAULT_BOT_SETTINGS, type SpaceEntry, type WorkItem } from '@baocut/protocol';
import { ProposalCard, SuggestionButtons } from './timeline/proposal-card.tsx';
import { useBotCall } from './bot-actions.ts';
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

describe('新建任务（需求 §4.4）', () => {
  it('默认「我来做」、不马上开始：直接添加时建的是用户自己的任务，进接下来', async () => {
    handlers['workItems.create'] = (p) => ({ item: { id: 'wi1', ...p } });
    await render(createElement(NewTaskDialog, { channelId: 'c1', onClose: () => {}, onCreated: () => {} }));
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.find((r) => r.checked)?.value).toBe('user');
    // 「我来做」时没有「马上开始」。
    expect(document.querySelector('input[role="switch"]')).toBeNull();
    await typeInto(document.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!, '录第 12 期口播');
    await press('添加');
    expect(calls('workItems.create')).toEqual([expect.objectContaining({ channelId: 'c1', title: '录第 12 期口播', owner: 'user', start: false })]);
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
});
