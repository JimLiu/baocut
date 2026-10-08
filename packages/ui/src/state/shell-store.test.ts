import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webVideoHref, type FileTarget } from '@baocut/protocol';
import { HOME, hasSidebar, hrefFor, migrateShell, parseHref, useShell, type Route } from './shell-store.ts';
import { itemKey } from '../model/workspace.ts';

// Node 里没有可用的 localStorage：给持久化一个内存版本，先于 store 模块加载。
vi.hoisted(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
});

const routes: Route[] = [
  HOME,
  { tab: 'home', conversationId: 'c1', projectId: null },
  { tab: 'home', conversationId: null, projectId: 'p1' },
  { tab: 'space', category: 'all', projectId: null },
  { tab: 'space', category: 'favorite', projectId: 'p1' },
  { tab: 'home', conversationId: 'c1', projectId: null, pane: { kind: 'video', target: { projectId: 'p1', path: '我的 视频/第一部' } } },
  { tab: 'home', conversationId: null, projectId: null, pane: { kind: 'video', target: { conversationId: 'c1', path: 'a?b=c&d' } } },
  { tab: 'home', conversationId: 'c1', projectId: null, pane: { kind: 'file', target: { conversationId: 'c1', path: 'notes.md' } } },
  { tab: 'home', conversationId: null, projectId: 'p1', pane: { kind: 'files' } },
  { tab: 'home', conversationId: 'c1', projectId: null, pane: { kind: 'web', id: 'w1', url: 'https://example.com/a?b=1&c=2' } },
  { tab: 'space', category: 'video', projectId: null, video: { entryId: 'e1' } },
  { tab: 'settings', section: 'diagnostics' },
  { tab: 'settings', section: 'agent' },
  { tab: 'settings', section: 'skills' },
  { tab: 'settings', section: 'privacy' },
  { tab: 'models', category: 'asr' },
  { tab: 'models', category: 'tts', page: 'voices' },
  { tab: 'tasks' },
  { tab: 'tasks', taskId: 't/1' },
  { tab: 'tools' },
  { tab: 'tools', tool: 'translate-subtitles' },
  { tab: 'services' },
  { tab: 'services', service: 'runtime' },
];

describe('界面内链接', () => {
  it('hrefFor 与 parseHref 互逆', () => {
    for (const route of routes) expect(parseHref(hrefFor(route))).toEqual(route);
  });

  it('Web 访问链接的视频地址（webVideoHref）经 parseHref 落到 Home 功能区的这个视频，再 hrefFor 得到同一个地址', () => {
    const targets: FileTarget[] = [
      { projectId: 'p1', path: '我的 视频/第一部' },
      { conversationId: 'c1', path: 'a?b=c&d#e' },
      { entryId: 'e1' },
    ];
    for (const target of targets) {
      const href = webVideoHref(target);
      const route = parseHref(href);
      expect(route).toEqual({ tab: 'home', conversationId: null, projectId: null, pane: { kind: 'video', target } });
      expect(hrefFor(route)).toBe(href);
    }
  });

  it('认不出的链接回到 Home 或该入口的起点', () => {
    expect(parseHref('/nope')).toEqual(HOME);
    expect(parseHref('/space/bogus')).toEqual({ tab: 'space', category: 'all', projectId: null });
    expect(parseHref('/settings/bogus')).toEqual({ tab: 'settings', section: 'general' });
    expect(parseHref('/tools/bogus')).toEqual({ tab: 'tools' });
  });

  it('旧链接迁移：设置里的模型页去模型页签，工具里的远端算力去服务', () => {
    expect(parseHref('/settings/voices')).toEqual({ tab: 'models', category: 'tts', page: 'voices' });
    expect(parseHref('/tools/remote')).toEqual({ tab: 'services', service: 'remote' });
  });

  it('旧链接迁移：/settings/agent/<页签> 去新的位置，认不出的页落到 Agent 提供方', () => {
    expect(parseHref('/settings/agent/skills')).toEqual({ tab: 'settings', section: 'skills' });
    expect(parseHref('/settings/agent/permissions')).toEqual({ tab: 'settings', section: 'privacy' });
    expect(parseHref('/settings/agent/advanced')).toEqual({ tab: 'settings', section: 'agent' });
    expect(parseHref('/settings/agent/connect')).toEqual({ tab: 'settings', section: 'agent' });
    expect(parseHref('/settings/agent/bogus')).toEqual({ tab: 'settings', section: 'agent' });
    expect(parseHref('/settings/agent')).toEqual({ tab: 'settings', section: 'agent' });
    expect(parseHref('/settings/skills')).toEqual({ tab: 'settings', section: 'skills' });
  });

  it('旧链接迁移：工具的旧短名落到注册表 ID 的新页', () => {
    expect(parseHref('/tools/translate')).toEqual({ tab: 'tools', tool: 'translate-subtitles' });
    expect(parseHref('/tools/compress')).toEqual({ tab: 'tools', tool: 'compress-video' });
    expect(parseHref('/tools/tts')).toEqual({ tab: 'tools', tool: 'synthesize-speech' });
    expect(parseHref('/tools/link-import')).toEqual({ tab: 'tools', tool: 'link-import' });
  });

  it('除了设置，每个入口都有页面侧栏；打开视频时侧栏还在', () => {
    expect(hasSidebar({ tab: 'space', category: 'video', projectId: null, video: { entryId: 'e1' } })).toBe(true);
    expect(hasSidebar({ tab: 'tasks', taskId: 't1' })).toBe(true);
    expect(hasSidebar({ tab: 'settings', section: 'about' })).toBe(false);
    expect(hasSidebar({ tab: 'models', category: 'llm' })).toBe(false);
  });
});

describe('前进后退与入口', () => {
  beforeEach(() => useShell.setState({ route: HOME, back: [], forward: [], lastRoute: {} }));

  it('模型配置属于设置：离开后返回设置恢复分类，再次点击回通用', () => {
    const { go, goTab, replace, goBack, goForward } = useShell.getState();
    const model = { tab: 'models' as const, category: 'tts' as const, page: 'voices' as const };
    go(model);
    expect(useShell.getState().lastRoute.settings).toEqual(model);
    goTab('tools');
    goTab('settings');
    expect(useShell.getState().route).toEqual(model);
    goTab('settings');
    expect(useShell.getState().route).toEqual({ tab: 'settings', section: 'general' });
    replace(model);
    goTab('tools');
    goBack();
    expect(useShell.getState().lastRoute.settings).toEqual(model);
    goForward();
    expect(useShell.getState().route).toEqual({ tab: 'tools' });
  });

  it('go 进历史，goBack / goForward 来回走，新的 go 清掉前进', () => {
    const { go, goBack, goForward } = useShell.getState();
    go({ tab: 'home', conversationId: 'c1', projectId: null });
    go({ tab: 'tasks' });
    goBack();
    expect(useShell.getState().route).toEqual({ tab: 'home', conversationId: 'c1', projectId: null });
    goForward();
    expect(useShell.getState().route).toEqual({ tab: 'tasks' });
    goBack();
    go({ tab: 'tools' });
    expect(useShell.getState().forward).toEqual([]);
  });

  it('同一个位置不重复进历史；replace 不进历史', () => {
    const { go, replace } = useShell.getState();
    go({ tab: 'tasks' });
    go({ tab: 'tasks' });
    replace({ tab: 'space', category: 'image', projectId: null });
    expect(useShell.getState().back).toEqual([HOME]);
  });

  it('点 rail 回到那个入口上次停留的地方；已经在那个入口时回到起点', () => {
    const { go, goTab } = useShell.getState();
    go({ tab: 'space', category: 'image', projectId: 'p1' });
    go({ tab: 'home', conversationId: 'c1', projectId: null });
    goTab('space');
    expect(useShell.getState().route).toEqual({ tab: 'space', category: 'image', projectId: 'p1' });
    goTab('space');
    expect(useShell.getState().route).toEqual({ tab: 'space', category: 'all', projectId: null });
  });
});

describe('Home 功能区标签', () => {
  beforeEach(() => useShell.setState({ route: HOME, back: [], forward: [], lastRoute: {}, workspaces: {} }));
  const video = { kind: 'video', target: { projectId: 'p1', path: 'v' } } as const;
  const files = { kind: 'files' } as const;

  it('打开的标签记在会话下；换会话再回来，标签还在', () => {
    const { go, openPane } = useShell.getState();
    go({ tab: 'home', conversationId: 'c1', projectId: null });
    openPane(video);
    openPane(files);
    go({ tab: 'home', conversationId: 'c2', projectId: null });
    expect(useShell.getState().workspaces.c2).toBeUndefined();
    useShell.getState().goBack();
    expect(useShell.getState().workspaces.c1?.tabs).toEqual([video, files]);
  });

  it('关掉当前标签，旁边的接上；关掉最后一个回到只有会话', () => {
    const { go, openPane, closePane } = useShell.getState();
    go({ tab: 'home', conversationId: 'c1', projectId: null });
    openPane(video);
    openPane(files);
    closePane('files');
    expect(useShell.getState().route).toEqual({ tab: 'home', conversationId: 'c1', projectId: null, pane: video });
    useShell.getState().closeVideo();
    expect(useShell.getState().route).toEqual({ tab: 'home', conversationId: 'c1', projectId: null });
    expect(useShell.getState().workspaces.c1).toEqual({ tabs: [], active: null });
  });

  const view = (key = 'c1') => useShell.getState().views[key];
  const hidden = (key = 'c1') => view(key)?.hidden ?? false;

  it('显示 / 隐藏标签页：显示着就收起，再点回来；路由上没有标签时回到收起前的那个', () => {
    useShell.setState({ views: {}, workspaceNarrow: false, hiddenBeforeNarrow: false });
    const { go, openPane, toggleWorkspace } = useShell.getState();
    go({ tab: 'home', conversationId: 'c1', projectId: null });
    openPane(video);
    openPane(files);
    toggleWorkspace();
    expect(view()).toEqual({ hidden: true, full: false });
    toggleWorkspace();
    expect(view()).toBeUndefined();
    // 从侧栏点回只有会话的位置：标签组记下 files；再显示时回到它。
    go({ tab: 'home', conversationId: 'c1', projectId: null });
    expect(useShell.getState().workspaces.c1).toEqual({ tabs: [video, files], active: null, last: 'files' });
    useShell.getState().toggleWorkspace();
    expect(useShell.getState().route).toEqual({ tab: 'home', conversationId: 'c1', projectId: null, pane: files });
  });

  it('没有标签时标签页按钮打开一个空白网页标签并显示分屏；完整视图按钮不动', () => {
    useShell.setState({ views: {}, workspaceNarrow: false });
    const { go, toggleWorkspace, toggleWorkspaceFull } = useShell.getState();
    go({ tab: 'home', conversationId: 'c1', projectId: null });
    toggleWorkspaceFull();
    expect(view()).toBeUndefined();
    toggleWorkspace();
    const route = useShell.getState().route;
    expect(route.tab === 'home' && route.pane).toMatchObject({ kind: 'web', url: '' });
    expect(useShell.getState().workspaces.c1?.tabs).toHaveLength(1);
    expect(view()).toBeUndefined();
  });

  it('视图按工作区记住：换会话不带过去，回来还在', () => {
    useShell.setState({ views: {}, workspaceNarrow: false });
    const { go, openPane, toggleWorkspace } = useShell.getState();
    go({ tab: 'home', conversationId: 'c1', projectId: null });
    openPane(video);
    toggleWorkspace();
    go({ tab: 'home', conversationId: 'c2', projectId: null });
    openPane(files);
    expect(view('c2')).toBeUndefined();
    useShell.getState().goBack();
    useShell.getState().goBack();
    expect(view()).toEqual({ hidden: true, full: false });
  });

  it('进入完整视图保留屏幕上的那一格；退出时会话回到左边、上次的标签回到右边', () => {
    useShell.setState({ views: {}, workspaceNarrow: false });
    const { go, openPane, toggleWorkspace, toggleWorkspaceFull } = useShell.getState();
    go({ tab: 'home', conversationId: 'c1', projectId: null });
    openPane(video);
    openPane(files);
    // 分屏可见：完整视图里是当前标签。
    toggleWorkspaceFull();
    expect(view()).toEqual({ hidden: false, full: true });
    // 完整视图里标签页按钮回到分屏。
    toggleWorkspace();
    expect(view()).toBeUndefined();
    expect(useShell.getState().route).toEqual({ tab: 'home', conversationId: 'c1', projectId: null, pane: files });
    // 功能区收起：完整视图里是会话；退出后分屏回来。
    toggleWorkspace();
    toggleWorkspaceFull();
    expect(view()).toEqual({ hidden: true, full: true });
    toggleWorkspaceFull();
    expect(view()).toBeUndefined();
    expect(useShell.getState().route).toEqual({ tab: 'home', conversationId: 'c1', projectId: null, pane: files });
    // 路由上没有标签时进入完整视图选着会话，退出时回到记下的标签。
    go({ tab: 'home', conversationId: 'c1', projectId: null });
    toggleWorkspaceFull();
    expect(view()).toEqual({ hidden: true, full: true });
    toggleWorkspaceFull();
    expect(useShell.getState().route).toEqual({ tab: 'home', conversationId: 'c1', projectId: null, pane: files });
  });

  it('标签列表：一行在分屏里打开，行尾在完整视图里打开；关掉最后一个标签离开完整视图', () => {
    useShell.setState({ views: {}, workspaceNarrow: false });
    const { go, openPane, toggleWorkspace, showWorkspaceTab, closePane } = useShell.getState();
    go({ tab: 'home', conversationId: 'c1', projectId: null });
    openPane(video);
    openPane(files);
    toggleWorkspace();
    const back = useShell.getState().back.length;
    showWorkspaceTab(itemKey(video), false);
    expect(useShell.getState().route).toEqual({ tab: 'home', conversationId: 'c1', projectId: null, pane: video });
    expect(view()).toBeUndefined();
    expect(useShell.getState().back.length).toBe(back);
    toggleWorkspace();
    showWorkspaceTab('files', true);
    expect(useShell.getState().route).toEqual({ tab: 'home', conversationId: 'c1', projectId: null, pane: files });
    expect(view()).toEqual({ hidden: false, full: true });
    showWorkspaceTab('missing', false);
    expect(view()).toEqual({ hidden: false, full: true });
    closePane('files');
    expect(view()).toEqual({ hidden: false, full: true });
    closePane(itemKey(video));
    expect(view()).toBeUndefined();
  });

  it('起始页的工具卡原地换掉新标签页：位置与标签数不变、路由换到新标签、不进历史；新标签已开着就挪过来', () => {
    useShell.setState({ views: {}, workspaceNarrow: false });
    const { go, openPane, replaceWorkspaceTab } = useShell.getState();
    go({ tab: 'home', conversationId: 'c1', projectId: 'p1' });
    const start = { kind: 'web', id: 'w1', url: '' } as const;
    const page = { kind: 'file', target: { projectId: 'p1', path: '新网页.html' } } as const;
    openPane(video);
    openPane(start);
    openPane({ kind: 'web', id: 'w2', url: 'https://example.com/' });
    useShell.getState().selectPane(itemKey(start));
    const back = useShell.getState().back.length;
    replaceWorkspaceTab(itemKey(start), files);
    expect(useShell.getState().workspaces.c1).toMatchObject({ tabs: [video, files, { id: 'w2' }], active: 'files' });
    expect(useShell.getState().route).toEqual({ tab: 'home', conversationId: 'c1', projectId: 'p1', pane: files });
    expect(useShell.getState().back.length).toBe(back);

    // 再开一个新标签页，换成一个已经开着的标签：挪到起始页的位置，不留两份。
    const second = { kind: 'web', id: 'w3', url: '' } as const;
    openPane(second);
    useShell.getState().movePane(itemKey(second), itemKey(video), false);
    replaceWorkspaceTab(itemKey(second), files);
    expect(useShell.getState().workspaces.c1?.tabs.map(itemKey)).toEqual(['files', itemKey(video), 'web:w2']);
    expect(useShell.getState().route).toMatchObject({ pane: files });

    // 起始页已经不在（比如被关掉）：照常打开。
    replaceWorkspaceTab('web:gone', page);
    expect(useShell.getState().workspaces.c1?.tabs.map(itemKey)).toEqual(['files', itemKey(video), 'web:w2', itemKey(page)]);
    expect(useShell.getState().route).toMatchObject({ pane: page });
  });

  it('草稿开了标签再建成会话：标签与视图一起带过去', () => {
    useShell.setState({ views: {}, workspaceNarrow: false });
    const { go, openPane, toggleWorkspaceFull, carryWorkspace } = useShell.getState();
    go({ tab: 'home', conversationId: null, projectId: 'p1' });
    openPane(files);
    toggleWorkspaceFull();
    carryWorkspace('new:p1', 'c9');
    expect(view('new:p1')).toBeUndefined();
    expect(view('c9')).toEqual({ hidden: false, full: true });
    expect(useShell.getState().workspaces.c9?.tabs).toEqual([files]);
  });

  it('要露出会话时：完整视图退回分屏，窄窗口选会话标签', () => {
    useShell.setState({ views: {}, workspaceNarrow: false });
    const { go, openPane, toggleWorkspaceFull, revealConversation } = useShell.getState();
    go({ tab: 'home', conversationId: 'c1', projectId: null });
    openPane(files);
    toggleWorkspaceFull();
    revealConversation();
    expect(view()).toBeUndefined();
    useShell.setState({ workspaceNarrow: true });
    revealConversation();
    expect(view()).toEqual({ hidden: true, full: false });
    useShell.setState({ workspaceNarrow: false });
  });

  describe('窄窗口：会话是固定的第一个标签', () => {
    const wide = () => useShell.setState({ workspaceNarrow: false, views: {}, hiddenBeforeNarrow: false });
    const at = () => {
      const { go, openPane } = useShell.getState();
      go({ tab: 'home', conversationId: 'c1', projectId: null });
      openPane(video);
    };

    it('挂载后第一次量只记下模式，深链的标签照样显示', () => {
      wide();
      at();
      useShell.getState().setWorkspaceNarrow(true, { initial: true });
      expect(useShell.getState().workspaceNarrow).toBe(true);
      expect(hidden()).toBe(false);
    });

    it('并排切到单列：焦点在会话区选会话标签，焦点在右侧停在当前标签', () => {
      wide();
      at();
      useShell.getState().setWorkspaceNarrow(true, { focusInConversation: true });
      expect(useShell.getState().workspaceNarrow).toBe(true);
      expect(hidden()).toBe(true);
      wide();
      useShell.getState().setWorkspaceNarrow(true, { focusInConversation: false });
      expect(useShell.getState().workspaceNarrow).toBe(true);
      expect(hidden()).toBe(false);
    });

    it('功能区本来就收起时选会话标签；一直停在那里，切回并排仍收起', () => {
      wide();
      at();
      useShell.getState().toggleWorkspace();
      useShell.getState().setWorkspaceNarrow(true);
      expect(hidden()).toBe(true);
      useShell.getState().setWorkspaceNarrow(false);
      expect(useShell.getState().workspaceNarrow).toBe(false);
      expect(hidden()).toBe(true);
    });

    it('收起后在单列里点过标签：切回并排时会话列与那个标签都回来', () => {
      wide();
      at();
      useShell.getState().toggleWorkspace();
      useShell.getState().setWorkspaceNarrow(true);
      useShell.getState().selectPane(itemKey(video));
      useShell.getState().showConversation();
      useShell.getState().setWorkspaceNarrow(false);
      expect(useShell.getState().workspaceNarrow).toBe(false);
      expect(hidden()).toBe(false);
    });

    it('因为焦点选了会话标签：切回并排时恢复双栏', () => {
      wide();
      at();
      useShell.getState().setWorkspaceNarrow(true, { focusInConversation: true });
      useShell.getState().setWorkspaceNarrow(false);
      expect(useShell.getState().workspaceNarrow).toBe(false);
      expect(hidden()).toBe(false);
    });

    it('选中会话标签后点标签才切过去', () => {
      wide();
      at();
      useShell.getState().setWorkspaceNarrow(true, { focusInConversation: true });
      expect(hidden()).toBe(true);
      useShell.getState().selectPane(itemKey(video));
      expect(hidden()).toBe(false);
      wide();
    });
  });

  it('网页换地址：后台标签只改标签组，不切换也不进历史；当前标签就地换掉路由', () => {
    const web = { kind: 'web', id: 'w1', url: '' } as const;
    const { go, openPane, selectPane, setWebUrl } = useShell.getState();
    go({ tab: 'home', conversationId: 'c1', projectId: null });
    openPane(web);
    openPane(files);
    const back = useShell.getState().back.length;
    setWebUrl('c1', 'w1', 'https://example.com/');
    expect(useShell.getState().route).toEqual({ tab: 'home', conversationId: 'c1', projectId: null, pane: files });
    expect(useShell.getState().workspaces.c1).toMatchObject({ tabs: [{ ...web, url: 'https://example.com/' }, files], active: 'files' });
    selectPane('web:w1');
    setWebUrl('c1', 'w1', 'https://example.com/next');
    expect(useShell.getState().route).toEqual({ tab: 'home', conversationId: 'c1', projectId: null, pane: { ...web, url: 'https://example.com/next' } });
    expect(useShell.getState().back.length).toBe(back);
    useShell.getState().setWebTitle('w1', '示例');
    expect(useShell.getState().webTitles.w1).toBe('示例');
  });

  it('拖动收起保留宽度、路由与标签，回拉或按钮能重新展开', () => {
    const { go, openPane, resizeWorkspace, toggleWorkspace } = useShell.getState();
    useShell.setState({ workspaceNarrow: false, views: {} });
    go({ tab: 'home', conversationId: 'c1', projectId: null });
    openPane(files);
    const route = useShell.getState().route;
    const workspaces = useShell.getState().workspaces;
    resizeWorkspace(1000, 1400);
    expect(useShell.getState()).toMatchObject({ dockWidth: 1000, workspaceNarrow: false });
    expect(view()).toBeUndefined();
    resizeWorkspace(1241, 1400);
    expect(useShell.getState().dockWidth).toBe(1000);
    expect(view()).toEqual({ hidden: true, full: false });
    expect(useShell.getState().route).toBe(route);
    expect(useShell.getState().workspaces).toBe(workspaces);
    resizeWorkspace(950, 1400);
    expect(useShell.getState().dockWidth).toBe(950);
    expect(view()).toBeUndefined();
    resizeWorkspace(1500, 1400);
    toggleWorkspace();
    expect(useShell.getState().dockWidth).toBe(950);
    expect(view()).toBeUndefined();
    resizeWorkspace(NaN, 1400);
    expect(useShell.getState().dockWidth).toBe(950);
    const saved = JSON.parse(localStorage.getItem('baocut.shell')!) as { state: Record<string, unknown> };
    expect(saved.state.views).toEqual({});
  });

  it('会话列宽至少 320，不再卡在 560，记在本机', () => {
    useShell.getState().setDockWidth(900);
    expect(useShell.getState().dockWidth).toBe(900);
    useShell.getState().setDockWidth(200);
    expect(useShell.getState().dockWidth).toBe(320);
    const saved = JSON.parse(localStorage.getItem('baocut.shell')!) as { state: Record<string, unknown> };
    expect(saved.state.dockWidth).toBe(320);
    expect(saved.state.workspaceNarrow).toBeUndefined();
  });
});

describe('视频的悬浮会话', () => {
  it('按视频记着会话，「新会话」清掉；最小化记在本机，会话不记', () => {
    useShell.getState().setVideoChat('p1/a.baocut', 'c1');
    useShell.getState().setVideoChat('p1/b.baocut', 'c2');
    expect(useShell.getState().videoChats).toEqual({ 'p1/a.baocut': 'c1', 'p1/b.baocut': 'c2' });
    useShell.getState().setVideoChat('p1/a.baocut', null);
    expect(useShell.getState().videoChats).toEqual({ 'p1/b.baocut': 'c2' });
    useShell.getState().setVideoChatMin(true);
    const saved = JSON.parse(localStorage.getItem('baocut.shell')!) as { state: Record<string, unknown> };
    expect(saved.state.videoChatMin).toBe(true);
    expect(saved.state.videoChats).toBeUndefined();
    useShell.getState().setVideoChatMin(false);
    useShell.getState().setVideoChat('p1/b.baocut', null);
  });

  it('读回的最小化不是布尔值就丢掉', () => {
    expect(migrateShell({ videoChatMin: 'yes' }, 4)).toEqual({ draftAccessModes: {} });
    expect(migrateShell({ videoChatMin: true }, 4)).toEqual({ draftAccessModes: {}, videoChatMin: true });
  });
});

describe('本机界面状态的迁移', () => {
  it('2 → 3：旧的自主模式丢掉，草稿上的访问模式只留认识的', () => {
    expect(migrateShell({ drafts: { a: 'hi' }, autonomy: { a: 'authorized' } }, 2)).toEqual({ drafts: { a: 'hi' }, draftAccessModes: {} });
    expect(migrateShell({ draftAccessModes: { a: 'auto', b: 'controlled', c: 3 } }, 3)).toEqual({ draftAccessModes: { a: 'auto' } });
  });

  it('3 → 4：旧数据里没有 Agent 选择与排队，取默认；有的逐条校验', () => {
    expect(migrateShell({ drafts: { a: 'hi' }, draftAccessModes: { a: 'ask' } }, 3)).toEqual({ drafts: { a: 'hi' }, draftAccessModes: { a: 'ask' } });
    const queued = { id: 'q1', text: '下一步', attachments: [], queuedAt: '2026-10-03T00:00:00Z' };
    expect(
      migrateShell(
        {
          draftAgents: { new: { driverId: 'codex', model: null, effort: 'high' }, p1: { driverId: 'Not Valid' }, p2: 'claude' },
          queues: { c1: [queued, { id: 'bad' }], c2: [{ text: 'x' }], c3: 'oops' },
        },
        3,
      ),
    ).toEqual({ draftAccessModes: {}, draftAgents: { new: { driverId: 'codex', model: null, effort: 'high' } }, queues: { c1: [queued] } });
    expect(migrateShell({ draftAgents: null, queues: [] }, 3)).toEqual({ draftAccessModes: {}, draftAgents: {}, queues: {} });
  });

  it('4 → 5：全局的收起 / 最大化丢掉，按工作区的视图只留有效的', () => {
    expect(migrateShell({ drafts: { a: 'hi' }, workspaceHidden: true, workspaceFull: true }, 4)).toEqual({ drafts: { a: 'hi' }, draftAccessModes: {} });
    expect(
      migrateShell(
        { views: { c1: { hidden: true }, c2: { hidden: false, full: false }, c3: 'x', new: { full: true, hidden: 'yes' }, 'new:p1': null } },
        4,
      ),
    ).toEqual({ draftAccessModes: {}, views: { c1: { hidden: true, full: false }, new: { hidden: false, full: true } } });
    expect(migrateShell({ views: [] }, 5)).toEqual({ draftAccessModes: {}, views: {} });
  });

  it('读回 v3 的本机状态：原有的照用，新字段是空的，写回时是 v5', async () => {
    localStorage.setItem(
      'baocut.shell',
      JSON.stringify({ state: { drafts: { new: '草稿' }, draftAccessModes: { new: 'auto' }, sidebarWidth: 300 }, version: 3 }),
    );
    await useShell.persist.rehydrate();
    const s = useShell.getState();
    expect(s.drafts).toEqual({ new: '草稿' });
    expect(s.draftAccessModes).toEqual({ new: 'auto' });
    expect(s.sidebarWidth).toBe(300);
    expect(s.draftAgents).toEqual({});
    expect(s.queues).toEqual({});
    s.setDraftAgent('new', { driverId: 'claude', model: 'opus' });
    const saved = JSON.parse(localStorage.getItem('baocut.shell')!) as { version: number; state: Record<string, unknown> };
    expect(saved.version).toBe(5);
    expect(saved.state.draftAgents).toEqual({ new: { driverId: 'claude', model: 'opus' } });
    expect(saved.state.views).toEqual({});
  });
});

describe('草稿上的 Agent 选择与排队', () => {
  beforeEach(() => useShell.setState({ draftAgents: {}, queues: {} }));

  it('setDraftAgent 记下或清掉一个草稿的选择', () => {
    useShell.getState().setDraftAgent('p1', { driverId: 'codex' });
    expect(useShell.getState().draftAgents).toEqual({ p1: { driverId: 'codex' } });
    useShell.getState().setDraftAgent('p1', null);
    expect(useShell.getState().draftAgents).toEqual({});
  });

  it('setQueue 按最新的队列改，改空了就删掉这条会话', () => {
    const item = (id: string) => ({ id, text: id, attachments: [], queuedAt: '2026-10-03T00:00:00Z' });
    useShell.getState().setQueue('c1', (q) => [...q, item('a')]);
    useShell.getState().setQueue('c1', (q) => [...q, item('b')]);
    expect(useShell.getState().queues.c1!.map((m) => m.id)).toEqual(['a', 'b']);
    useShell.getState().setQueue('c1', () => []);
    expect(useShell.getState().queues).toEqual({});
  });
});

it('候选图切换原位替换文件标签，去重并同步路由', () => {
  const a = { kind: 'file' as const, target: { conversationId: 'c1', path: 'a.png' } };
  const b = { kind: 'file' as const, target: { conversationId: 'c1', path: 'b.png' } };
  const other = { kind: 'files' as const };
  useShell.setState({ route: { tab: 'home', conversationId: 'c1', projectId: null, pane: a }, workspaces: { c1: { tabs: [other, a, b], active: itemKey(a) } } });
  useShell.getState().replaceFilePane(itemKey(a), b.target);
  expect(useShell.getState().workspaces.c1).toMatchObject({ tabs: [other, b], active: itemKey(b) });
  expect(useShell.getState().route).toMatchObject({ pane: b });
});

it('已发送附件的文件标签保留会话权限定位及显示名称',()=>{
  const route = {tab:'home' as const,conversationId:'c1',projectId:null,pane:{kind:'file' as const,target:{conversationId:'c1',attachmentId:'att_a'},name:'报告.pdf'}};
  expect(parseHref(hrefFor(route))).toEqual(route);
});
