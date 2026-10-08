import { describe, expect, it } from 'vitest';
import type { SpaceEntry } from '@baocut/protocol';
import {
  CONVERSATION_TAB,
  DOCK_DEFAULT,
  EDITOR_MIN_WIDTH,
  EMPTY_WORKSPACE,
  clampDock,
  closeTab,
  dockFor,
  dragOffsets,
  dragTarget,
  entryOfTarget,
  fullViewEntry,
  homeBarBounds,
  isNarrow,
  isVideoReferenced,
  itemKey,
  moveTab,
  openTab,
  narrowShowsConversation,
  reconcileTabs,
  replaceTab,
  restoreKey,
  resizeSplit,
  safeUrl,
  summaryInHead,
  tabKeyIndex,
  tabsButton,
  targetKey,
  updateWebUrl,
  workspaceMode,
  workspaceTitle,
  type WorkspaceItem,
} from './workspace.ts';

const video: WorkspaceItem = { kind: 'video', target: { projectId: 'p1', path: '视频/第一部' } };
const file: WorkspaceItem = { kind: 'file', target: { conversationId: 'c1', path: 'notes.md' } };
const files: WorkspaceItem = { kind: 'files' };
const web: WorkspaceItem = { kind: 'web', id: 'w1', url: '' };

describe('标签的开关与排序', () => {
  it('打开同 key 的标签就地换成新的，不重复；关掉当前标签由同位置的下一个接上', () => {
    let state = openTab(openTab(openTab(EMPTY_WORKSPACE, video), file), files);
    state = openTab(state, video);
    expect(state.tabs).toEqual([video, file, files]);
    expect(state.active).toBe(itemKey(video));
    state = closeTab(state, itemKey(video));
    expect(state).toEqual({ tabs: [file, files], active: itemKey(file) });
    expect(closeTab(state, 'nope')).toBe(state);
  });

  it('replaceTab 原地换掉一个标签并选中它；新标签已开着时挪过来；没有这个标签时等于打开', () => {
    const state = { tabs: [video, web, file], active: itemKey(web) };
    expect(replaceTab(state, itemKey(web), files)).toEqual({ tabs: [video, files, file], active: 'files' });
    expect(replaceTab(state, itemKey(web), file)).toEqual({ tabs: [video, file], active: itemKey(file) });
    expect(replaceTab(state, 'nope', files)).toEqual(openTab(state, files));
  });

  it('moveTab 挪到目标前后；没变化时返回原对象', () => {
    const state = { tabs: [video, file, files], active: null };
    expect(moveTab(state, 'files', itemKey(video)).tabs).toEqual([files, video, file]);
    expect(moveTab(state, itemKey(video), 'files', true).tabs).toEqual([file, files, video]);
    expect(moveTab(state, itemKey(video), itemKey(file))).toBe(state);
  });
});

describe('收起与恢复右侧区域', () => {
  it('路由离开标签时收起并记下刚才的标签；「显示右侧区域」回到它', () => {
    const open = { tabs: [video, file, files], active: itemKey(file) };
    const collapsed = reconcileTabs(open, undefined);
    expect(collapsed).toEqual({ tabs: open.tabs, active: null, last: itemKey(file) });
    expect(reconcileTabs(collapsed, undefined)).toBe(collapsed);
    expect(restoreKey(collapsed)).toBe(itemKey(file));
    expect(restoreKey(open)).toBe(itemKey(file));
  });

  it('记下的标签关掉了就回到最后一个；一个都没有时是 null', () => {
    const collapsed = { tabs: [video, file], active: null, last: 'files' };
    expect(restoreKey(collapsed)).toBe(itemKey(file));
    expect(closeTab({ tabs: [video, file], active: null, last: itemKey(file) }, itemKey(file))).toEqual({ tabs: [video], active: null });
    expect(closeTab({ tabs: [video, file], active: null, last: itemKey(file) }, itemKey(video)).last).toBe(itemKey(file));
    expect(restoreKey(EMPTY_WORKSPACE)).toBeNull();
  });

  it('重新打开标签时不再带着记下的标签', () => {
    const collapsed = { tabs: [video], active: null, last: itemKey(video) };
    expect(reconcileTabs(collapsed, files)).toEqual({ tabs: [video, files], active: 'files' });
  });
});

describe('网页标签换地址', () => {
  it('就地改 url，不动当前标签与顺序；没这个标签或没变化时原样返回', () => {
    const state = { tabs: [web, video], active: itemKey(video) };
    const next = updateWebUrl(state, 'w1', 'https://example.com/');
    expect(next).toEqual({ tabs: [{ ...web, url: 'https://example.com/' }, video], active: itemKey(video) });
    expect(updateWebUrl(next, 'w1', 'https://example.com/')).toBe(next);
    expect(updateWebUrl(state, 'nope', 'https://example.com/')).toBe(state);
  });
});

describe('视频还被哪条会话的标签引用', () => {
  it('任何一组标签里还有这个视频就不关', () => {
    const key = targetKey(video.kind === 'video' ? video.target : { entryId: '' });
    expect(isVideoReferenced({ c1: { tabs: [file], active: null }, c2: { tabs: [video], active: null } }, key)).toBe(true);
    expect(isVideoReferenced({ c1: { tabs: [file], active: null } }, key)).toBe(false);
    // 同一路径的「文件」标签不算视频。
    expect(isVideoReferenced({ c1: { tabs: [{ kind: 'file', target: { projectId: 'p1', path: '视频/第一部' } }], active: null } }, key)).toBe(false);
  });
});

describe('会话列宽与窄窗口', () => {
  it('宽度至少 320，取整，不再卡在 560', () => {
    expect(clampDock(100)).toBe(320);
    expect(clampDock(900)).toBe(900);
    expect(clampDock(400.4)).toBe(400);
    expect(clampDock(NaN)).toBe(DOCK_DEFAULT);
    expect(DOCK_DEFAULT).toBe(380);
  });

  it('会话列保留右侧 320，但能超过原来的 45%', () => {
    expect(dockFor(2000, 380)).toBe(380);
    expect(dockFor(1400, 1000)).toBe(1000);
    expect(dockFor(1000, 900)).toBe(680);
    expect(dockFor(600, 380)).toBe(320);
  });

  it('拖过右侧最小宽度后继续跟踪，到 160 阈值才隐藏，回拉可展开', () => {
    expect(resizeSplit(800, 1400)).toEqual({ width: 800, hidden: false });
    expect(resizeSplit(1240, 1400)).toEqual({ width: 1080, hidden: false });
    expect(resizeSplit(1241, 1400)).toEqual({ width: 1080, hidden: true });
    expect(resizeSplit(1700, 1400)).toEqual({ width: 1080, hidden: true });
    expect(resizeSplit(950, 1400)).toEqual({ width: 950, hidden: false });
    expect(resizeSplit(100, 1400)).toEqual({ width: 320, hidden: false });
  });

  it('窄模式只看容器，不随拖动中会话宽度变化', () => {
    expect(EDITOR_MIN_WIDTH).toBe(695);
    expect(isNarrow(1400)).toBe(false);
    expect(isNarrow(1015)).toBe(false);
    expect(isNarrow(1014)).toBe(true);
    expect(isNarrow(960)).toBe(true);
    for (const width of [0, -1, NaN, Infinity]) expect(isNarrow(width)).toBe(false);
  });

  it('切到单列时：焦点在会话区或功能区收起选会话，否则停在当前标签', () => {
    expect(narrowShowsConversation(true, true)).toBe(true);
    expect(narrowShowsConversation(false, false)).toBe(true);
    expect(narrowShowsConversation(false, true)).toBe(false);
  });
});

describe('标签名与条目', () => {
  const entry = (id: string, patch: Partial<SpaceEntry>): SpaceEntry => ({
    id,
    kind: 'video',
    name: id,
    fileName: id,
    source: { projectId: 'p1', conversationId: null },
    relPath: id,
    size: 0,
    lastActivityAt: '2026-10-01T00:00:00.000Z',
    status: null,
    user: { favorite: false, displayName: null, trashedAt: null },
    ...patch,
  });

  it('项目文件、网页主机名、条目名，找不到条目时用路径末段，再不行就是不可用', () => {
    expect(workspaceTitle(files)).toBe('项目文件');
    expect(workspaceTitle(web)).toBe('新标签页');
    expect(workspaceTitle({ kind: 'web', id: 'w', url: 'https://example.com/a' })).toBe('example.com');
    expect(workspaceTitle({ kind: 'web', id: 'w', url: 'https://example.com/a' }, '示例页面')).toBe('示例页面');
    expect(workspaceTitle(video, '宣传片')).toBe('宣传片');
    expect(workspaceTitle(video)).toBe('第一部');
    expect(workspaceTitle({ kind: 'video', target: { entryId: 'e1' } })).toBe('视频不可用');
    expect(workspaceTitle({ kind: 'file', target: { entryId: 'e1' } })).toBe('文件不可用');
  });

  it('按条目 id、项目路径或会话路径找到 Space 条目', () => {
    const entries = [
      entry('e1', { relPath: '视频/第一部', name: '第一部' }),
      entry('e2', { relPath: 'notes.md', source: { projectId: null, conversationId: 'c1' } }),
    ];
    expect(entryOfTarget(entries, { entryId: 'e2' })?.id).toBe('e2');
    expect(entryOfTarget(entries, { projectId: 'p1', path: '视频/第一部' })?.id).toBe('e1');
    expect(entryOfTarget(entries, { conversationId: 'c1', path: 'notes.md' })?.id).toBe('e2');
    expect(entryOfTarget(entries, { projectId: 'p2', path: '视频/第一部' })).toBeUndefined();
  });
});

describe('标签条的键盘与拖动', () => {
  it('左右循环，Home / End 到两头', () => {
    expect(tabKeyIndex('ArrowRight', 2, 3)).toBe(0);
    expect(tabKeyIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(tabKeyIndex('Home', 2, 3)).toBe(0);
    expect(tabKeyIndex('End', 0, 3)).toBe(2);
    expect(tabKeyIndex('Enter', 0, 3)).toBeNull();
    expect(tabKeyIndex('ArrowRight', 0, 0)).toBeNull();
  });

  it('拖动按未变换的槽位判断目标，邻居平移成放下后的顺序', () => {
    const rects = [
      { key: 'a', left: 0, width: 100 },
      { key: 'b', left: 104, width: 100 },
      { key: 'c', left: 208, width: 100 },
    ];
    expect(dragTarget(rects, 'a', 180)).toEqual({ key: 'c', after: false });
    expect(dragTarget(rects, 'a', 300)).toEqual({ key: 'c', after: true });
    expect(dragOffsets(rects, 'a', { key: 'c', after: true })).toEqual({ b: -104, c: -104, a: 208 });
  });
});

describe('Home 标题栏的分界', () => {
  const base = {
    origin: 0,
    width: 1400,
    navRight: 180,
    content: { left: 300, right: 1300 },
    conversationRight: 680,
    controlsLeft: 1260,
    hasPane: true,
    single: false,
  };

  it('右侧显示着时对齐会话列的缝；标签条与会话头的右端让开量出来的按钮组左缘 4px', () => {
    expect(homeBarBounds(base)).toEqual({ left: 300, split: 680, right: 144 });
    expect(homeBarBounds({ ...base, hasPane: false, conversationRight: null })).toEqual({ left: 300, split: 1256, right: 144 });
    // 按钮组变宽，右端跟着让开。
    expect(homeBarBounds({ ...base, hasPane: false, conversationRight: null, controlsLeft: 1180 })).toEqual({ left: 300, split: 1176, right: 224 });
  });

  it('按钮组在内容区右缘之外或没有按钮时，排到内容区右缘', () => {
    expect(homeBarBounds({ ...base, controlsLeft: 1340 })?.right).toBe(100);
    expect(homeBarBounds({ ...base, controlsLeft: null })?.right).toBe(100);
  });

  it('单条标签条时标签条从左缘开始；会话列还没量到时先给个估计；离后退前进至少 12', () => {
    expect(homeBarBounds({ ...base, single: true })).toEqual({ left: 300, split: 300, right: 144 });
    expect(homeBarBounds({ ...base, single: true, hasPane: false, conversationRight: null })).toEqual({ left: 300, split: 300, right: 144 });
    expect(homeBarBounds({ ...base, conversationRight: null })?.split).toBe(540);
    expect(homeBarBounds({ ...base, content: { left: 100, right: 1300 } })?.left).toBe(192);
    expect(homeBarBounds({ ...base, content: null })).toBeNull();
  });
});

describe('工作区视图', () => {
  const view = (hidden: boolean, full: boolean) => ({ hidden, full });

  it('完整视图要有标签；单条 = 窄窗口或完整视图；单条里功能区收起就是选着会话', () => {
    expect(workspaceMode({ active: 'a', count: 1, view: view(false, false), narrow: false })).toEqual({
      visible: true,
      full: false,
      single: false,
      conversation: false,
    });
    expect(workspaceMode({ active: null, count: 0, view: view(false, true), narrow: false })).toEqual({
      visible: false,
      full: false,
      single: false,
      conversation: false,
    });
    expect(workspaceMode({ active: null, count: 2, view: view(true, true), narrow: false })).toEqual({
      visible: false,
      full: true,
      single: true,
      conversation: true,
    });
    expect(workspaceMode({ active: 'a', count: 2, view: view(false, false), narrow: true })).toMatchObject({ single: true, conversation: false });
  });

  it('进入完整视图时保留屏幕上的那一格：分屏可见是当前标签，否则是会话', () => {
    expect(fullViewEntry(true, 'web:1')).toBe('web:1');
    expect(fullViewEntry(false, 'web:1')).toBe(CONVERSATION_TAB);
    expect(fullViewEntry(true, null)).toBe(CONVERSATION_TAB);
  });

  it('标签页按钮：没有标签 → 打开；完整视图 → 分屏；分屏可见 → 隐藏；收起 → 显示并列出标签', () => {
    expect(tabsButton({ count: 0, visible: false, full: false })).toEqual({ action: 'open', glyph: 'tabs-plus', listed: false });
    expect(tabsButton({ count: 3, visible: true, full: true })).toEqual({ action: 'split', glyph: 'hide-tabs', listed: false });
    expect(tabsButton({ count: 3, visible: false, full: true })).toEqual({ action: 'split', glyph: 'hide-tabs', listed: false });
    expect(tabsButton({ count: 3, visible: true, full: false })).toEqual({ action: 'hide', glyph: 'hide-tabs', listed: false });
    expect(tabsButton({ count: 3, visible: false, full: false })).toEqual({ action: 'show', glyph: 'count', badge: '3', listed: true });
    expect(tabsButton({ count: 9, visible: false, full: false }).badge).toBe('9');
    expect(tabsButton({ count: 10, visible: false, full: false }).badge).toBe('9+');
  });

  it('会话摘要只在分屏可见时挂进会话头', () => {
    expect(summaryInHead({ visible: true, single: false, count: 1 })).toBe(true);
    expect(summaryInHead({ visible: false, single: false, count: 1 })).toBe(false);
    expect(summaryInHead({ visible: true, single: true, count: 1 })).toBe(false);
    expect(summaryInHead({ visible: true, single: false, count: 0 })).toBe(false);
  });
});

describe('地址栏输入', () => {
  it('只认 http/https；localhost 与主机:端口补上协议', () => {
    expect(safeUrl('example.com')).toBe('https://example.com/');
    expect(safeUrl('localhost:3000')).toBe('http://localhost:3000/');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('https://u:p@example.com')).toBeNull();
  });
});
