import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  AGENT_MODES,
  fileTargetQuery,
  isLanguagePreference,
  newId,
  type AgentMode,
  type FileTarget,
  type MediaTarget,
  type Id,
  type LanguagePreference,
} from '@baocut/protocol';
import { parseAgentChoice, type AgentChoice } from '../model/agent-choice.ts';
import { isQueuedMessage, type QueuedMessage } from '../model/message-queue.ts';
import {
  isModelCategory,
  isModelPage,
  isSettingsSection,
  legacyAgentSection,
  type ModelCategory,
  type ModelPage,
  type SettingsSection,
} from '../model/settings-nav.ts';
import type { SidebarSort } from '../model/sidebar.ts';
import { SPACE_CATEGORIES, type SpaceCategory, type SpaceSort } from '../model/space.ts';
import { toolIdOf, type ToolId } from '../model/tool-catalog.ts';
import {
  CONVERSATION_TAB,
  DEFAULT_VIEW,
  DOCK_DEFAULT,
  EMPTY_WORKSPACE,
  clampDock,
  closeTab,
  fullViewEntry,
  itemKey,
  moveTab,
  narrowShowsConversation,
  reconcileTabs,
  replaceTab,
  restoreKey,
  resizeSplit,
  tabsButton,
  updateWebUrl,
  workspaceKey,
  workspaceMode,
  type WorkspaceItem,
  type WorkspaceTabs,
  type WorkspaceView,
} from '../model/workspace.ts';

export type { SettingsSection } from '../model/settings-nav.ts';
export { SETTINGS_SECTIONS } from '../model/settings-nav.ts';

/** 一级入口（App rail，产品设计 §2.1 用户修订）。 */
export type Tab = 'home' | 'space' | 'tasks' | 'models' | 'services' | 'tools' | 'settings';

/**
 * Home 的 `pane`：会话右侧功能区当前的标签（视频、文件、项目文件、网页）；同一条会话的其他标签记在 `workspaces` 里。
 * Space 的 `video`：在 Space 打开的视频（产品设计 §5.1），编辑器加悬浮会话；关闭回到列表。
 */
export type Route =
  | { tab: 'home'; conversationId: Id | null; projectId: Id | null; pane?: WorkspaceItem }
  | { tab: 'space'; category: SpaceCategory; projectId: Id | null; video?: FileTarget }
  | { tab: 'settings'; section: SettingsSection }
  | { tab: 'models'; category: ModelCategory; page?: ModelPage }
  | { tab: 'tasks'; taskId?: Id }
  | { tab: 'services'; service?: string }
  | { tab: 'tools'; tool?: ToolId };

export type ColorScheme = 'system' | 'light' | 'dark';

export const SIDEBAR_DEFAULT = 240;
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 420;
const HISTORY_MAX = 50;

/** 新会话的草稿键。 */
export const NEW_DRAFT = 'new';

export const HOME: Route = { tab: 'home', conversationId: null, projectId: null };

/**
 * 只属于这台机器、这个窗口的界面状态：路由与前进后退、各入口上次停留的地方、侧栏、草稿、偏好。
 * 业务状态不放这里，它们来自 Runtime。
 */
export interface ShellStore {
  route: Route;
  back: Route[];
  forward: Route[];
  /** 每个入口上次停留的地方：点 rail 回到那里（产品设计 §2.1）。 */
  lastRoute: Partial<Record<Tab, Route>>;
  sidebarWidth: number;
  sidebarHidden: boolean;
  drafts: Record<string, string>;
  /** 还没建出来的新会话（草稿键）选的访问模式。建好的会话的访问模式在 Runtime 里，不在这里。 */
  draftAccessModes: Record<string, AgentMode>;
  expandedProjects: Id[];
  /** Home 侧栏「整理侧栏」：按项目分组，或所有会话在一个列表中。 */
  sidebarGrouping: 'project' | 'flat';
  sidebarSort: SidebarSort;
  colorScheme: ColorScheme;
  /** 界面语言（设置 › 通用）：`system` 跟随系统。桌面端还把它写进 Runtime 的 `ui.language`（state/locale.ts）。 */
  language: LanguagePreference;
  spaceView: 'grid' | 'list';
  spaceSort: SpaceSort;
  /** 每条会话（新会话按项目）的功能区标签（产品设计 §3.3 用户修订）。 */
  workspaces: Record<string, WorkspaceTabs>;
  /**
   * 每条会话（新会话按草稿键）自己的视图：功能区收起与完整视图（产品设计 §2.5、§3.3 用户修订）。换会话不改别的会话的视图。
   * 单条标签条（窄窗口、完整视图）里收起就是选中了会话标签（`showConversation`）。记在本机。
   */
  views: Record<string, WorkspaceView>;
  /** Home 会话列的宽度（与右侧标签共用一个，原型 `dockW`）。 */
  dockWidth: number;
  /**
   * 窄窗口（放不下会话列与编辑器，产品设计 §2.5、§3.3）：单列，会话是标签条里固定的第一个标签。
   * 由 HomePage 量出来写进来，标题栏照着排。
   */
  workspaceNarrow: boolean;
  /** 切到窄窗口之前功能区是不是用户收起的：切回并排时，只有它为真且一直停在会话标签上才保持收起。不记在本机。 */
  hiddenBeforeNarrow: boolean;
  /** 网页标签的页面标题（按标签 id），用作标签名；不记在本机，重开后页面载入时再报。 */
  webTitles: Record<string, string>;
  /** 模型页每一类上次停留的页签。 */
  modelPages: Partial<Record<ModelCategory, ModelPage>>;
  /** 还没建出来的新会话（草稿键）选的 Agent、模型与推理强度；建好的会话的选择在 Runtime 里。 */
  draftAgents: Record<string, AgentChoice>;
  /** 每条会话忙时排队、等当前任务结束再发的消息。 */
  queues: Record<Id, QueuedMessage[]>;
  /** Space 里打开的视频右下角那条悬浮会话（按视频的 `targetKey`）；只在这次运行里记着，重开后从新会话开始。 */
  videoChats: Record<string, Id>;
  /** 悬浮会话最小化成图标；默认展开，最小化后记在本机。 */
  videoChatMin: boolean;
  navigate(href: string): void;
  go(route: Route): void;
  /** 替换当前位置，不进历史（筛选、分类这类原地切换）。 */
  replace(route: Route): void;
  goBack(): void;
  goForward(): void;
  /** 点 rail：去这个入口上次停留的地方；已经在这个入口时回到它的起点。 */
  goTab(tab: Tab): void;
  /** 在当前入口打开视频（Home 或 Space）；在其他页时去 Home。 */
  openVideo(video: FileTarget, from?: { conversationId?: Id | null; projectId?: Id | null }): void;
  /** 关闭视频，回到打开它之前的位置（Home：关掉这个标签，旁边的标签接上）。 */
  closeVideo(): void;
  /** 在当前 Home 会话的功能区打开一个标签；不在 Home 时去 Home。 */
  openPane(item: WorkspaceItem, from?: { conversationId?: Id | null; projectId?: Id | null }): void;
  selectPane(key: string): void;
  replaceFilePane(key: string, target: MediaTarget): void;
  /**
   * 把当前 Home 会话的标签 `key` 原地换成 `item`（新标签页起始页的工具卡：新建网页、浏览项目文件）：位置不变、路由换到新标签、不进历史；
   * `item` 已在别处打开时挪到这个位置（model/workspace.ts `replaceTab`）。没有 `key` 这个标签时等于 `openPane`。
   */
  replaceWorkspaceTab(key: string, item: WorkspaceItem): void;
  closePane(key: string): void;
  movePane(key: string, target: string, after: boolean): void;
  /** 新会话发出第一句、变成真正的会话时，把起始页上开着的标签与视图带过去。 */
  carryWorkspace(from: string, to: Id): void;
  /**
   * 标题栏「标签页」按钮（model/workspace.ts `tabsButton`）：没有标签时打开新标签页（空地址的网页标签）并显示分屏；
   * 完整视图里回到分屏；分屏显示着时收起；收起了就回到当前、收起前或最后一个标签。
   */
  toggleWorkspace(): void;
  /** 进入 / 退出完整视图。进入时保留屏幕上的样子（`fullViewEntry`）；退出时会话回到左边，上次的标签回到右边。窄窗口里没有这个按钮。 */
  toggleWorkspaceFull(): void;
  /** 已打开的标签页列表：选中这个标签并显示分屏，`full` 时直接进完整视图。 */
  showWorkspaceTab(key: string, full: boolean): void;
  /** 选中会话标签（单条标签条里）：只收起功能区；路由、标签与编辑器状态都不动。 */
  showConversation(): void;
  /** 让会话露出来：窄窗口里选中会话标签，完整视图退回分屏；会话本来就看得见时什么都不做。 */
  revealConversation(): void;
  setDockWidth(width: number): void;
  resizeWorkspace(width: number, contentWidth: number): void;
  /**
   * 量出来的窄 / 宽。模式没变什么都不做；`initial`（挂载后第一次量）只记下模式，不切换标签。
   * 并排 → 单列：焦点在会话区（`focusInConversation`）或功能区本来就收起时选会话标签，否则停在当前标签。
   * 单列 → 并排：会话列与上次的标签都回来；只有切过来之前就收起、并且一直停在会话标签上，才保持收起。
   */
  setWorkspaceNarrow(narrow: boolean, options?: { focusInConversation?: boolean; initial?: boolean }): void;
  /** 网页标签里的页面换了地址：改那组标签里的 `url`，不切换当前标签；它正是当前标签时就地换掉路由（不进历史）。 */
  setWebUrl(book: string, id: string, url: string): void;
  setWebTitle(id: string, title: string): void;
  setModelPage(category: ModelCategory, page: ModelPage): void;
  setSidebarWidth(width: number): void;
  toggleSidebar(): void;
  setDraft(key: string, text: string): void;
  setDraftAccessMode(key: string, mode: AgentMode | null): void;
  setDraftAgent(key: string, choice: AgentChoice | null): void;
  /** 按最新的队列改；改成空的就把这条会话的队列删掉。 */
  setQueue(conversationId: Id, update: (queue: readonly QueuedMessage[]) => QueuedMessage[]): void;
  setVideoChat(key: string, conversationId: Id | null): void;
  setVideoChatMin(min: boolean): void;
  setExpandedProjects(ids: Id[]): void;
  setSidebarGrouping(grouping: 'project' | 'flat'): void;
  setSidebarSort(sort: SidebarSort): void;
  setColorScheme(scheme: ColorScheme): void;
  setLanguage(language: LanguagePreference): void;
  setSpaceView(view: 'grid' | 'list'): void;
  setSpaceSort(sort: SpaceSort): void;
}

export const useShell = create<ShellStore>()(
  persist(
    (set, get) => ({
      route: HOME,
      back: [],
      forward: [],
      lastRoute: {},
      sidebarWidth: SIDEBAR_DEFAULT,
      sidebarHidden: false,
      drafts: {},
      draftAccessModes: {},
      expandedProjects: [],
      sidebarGrouping: 'project',
      sidebarSort: 'recent',
      colorScheme: 'system',
      language: 'system',
      spaceView: 'grid',
      spaceSort: 'recent',
      workspaces: {},
      views: {},
      dockWidth: DOCK_DEFAULT,
      workspaceNarrow: false,
      hiddenBeforeNarrow: false,
      webTitles: {},
      modelPages: {},
      draftAgents: {},
      queues: {},
      videoChats: {},
      videoChatMin: false,
      navigate: (href) => get().go(parseHref(href)),
      go: (route) =>
        set((s) => {
          if (sameRoute(s.route, route)) return {};
          return {
            route,
            back: [...s.back, s.route].slice(-HISTORY_MAX),
            forward: [],
            lastRoute: { ...s.lastRoute, [railTabOf(route)]: route },
            ...arrive(s, route),
          };
        }),
      replace: (route) => set((s) => ({ route, lastRoute: { ...s.lastRoute, [railTabOf(route)]: route }, ...arrive(s, route) })),
      goBack: () =>
        set((s) => {
          const previous = s.back.at(-1);
          if (!previous) return {};
          return {
            route: previous,
            back: s.back.slice(0, -1),
            forward: [s.route, ...s.forward],
            lastRoute: { ...s.lastRoute, [railTabOf(previous)]: previous },
            ...arrive(s, previous),
          };
        }),
      goForward: () =>
        set((s) => {
          const next = s.forward[0];
          if (!next) return {};
          return {
            route: next,
            back: [...s.back, s.route],
            forward: s.forward.slice(1),
            lastRoute: { ...s.lastRoute, [railTabOf(next)]: next },
            ...arrive(s, next),
          };
        }),
      goTab: (tab) => {
        const { route, lastRoute, go } = get();
        const key = tab === 'models' ? 'settings' : tab;
        go(railTabOf(route) === key ? defaultRoute(key) : (lastRoute[key] ?? defaultRoute(key)));
      },
      openVideo: (video, from) => {
        const { route, go, openPane } = get();
        if (route.tab === 'space' && !from) go({ ...route, video });
        else openPane({ kind: 'video', target: video }, from);
      },
      closeVideo: () => {
        const { route, go, closePane } = get();
        if (route.tab === 'space' && route.video) {
          const { video: _video, ...rest } = route;
          go(rest);
        } else if (route.tab === 'home' && route.pane?.kind === 'video') closePane(itemKey(route.pane));
      },
      openPane: (pane, from) => {
        const { route, go } = get();
        if (route.tab === 'home' && !from) go({ ...route, pane });
        else go({ tab: 'home', conversationId: from?.conversationId ?? null, projectId: from?.projectId ?? null, pane });
        set((s) => ({ ...patchView(s, { hidden: false }), hiddenBeforeNarrow: false }));
      },
      selectPane: (key) => {
        const { route, workspaces, replace } = get();
        if (route.tab !== 'home') return;
        const pane = (workspaces[workspaceKey(route.conversationId, route.projectId)] ?? EMPTY_WORKSPACE).tabs.find((t) => itemKey(t) === key);
        if (pane) replace({ ...route, pane });
        set((s) => ({ ...patchView(s, { hidden: false }), hiddenBeforeNarrow: false }));
      },
      replaceFilePane: (key, target) => {
        const { route, workspaces } = get();
        if (route.tab !== 'home') return;
        const previous = workspaces[workspaceKey(route.conversationId, route.projectId)] ?? EMPTY_WORKSPACE;
        if (!previous.tabs.some(item => itemKey(item) === key && item.kind === 'file')) return;
        get().replaceWorkspaceTab(key, { kind: 'file', target });
      },
      replaceWorkspaceTab: (key, item) => {
        const { route, workspaces, openPane } = get();
        if (route.tab !== 'home') return;
        const book = workspaceKey(route.conversationId, route.projectId);
        const previous = workspaces[book] ?? EMPTY_WORKSPACE;
        if (!previous.tabs.some((t) => itemKey(t) === key)) return openPane(item);
        set((s) => ({ workspaces: { ...s.workspaces, [book]: replaceTab(previous, key, item) } }));
        get().replace({ ...route, pane: item });
      },
      closePane: (key) => {
        const { route, workspaces } = get();
        if (route.tab !== 'home') return;
        const book = workspaceKey(route.conversationId, route.projectId);
        const next = closeTab(workspaces[book] ?? EMPTY_WORKSPACE, key);
        const pane = next.tabs.find((t) => itemKey(t) === next.active);
        const { pane: _pane, ...rest } = route;
        // 关掉最后一个标签就离开完整视图，回到只有会话。选中会话标签时关掉后面那个标签不把视图带到邻居上（hidden 不动）。
        set((s) => ({ workspaces: { ...s.workspaces, [book]: next }, ...(next.tabs.length ? {} : patchView(s, DEFAULT_VIEW)) }));
        get().replace(pane ? { ...rest, pane } : rest);
      },
      movePane: (key, target, after) => {
        const { route } = get();
        if (route.tab !== 'home') return;
        const book = workspaceKey(route.conversationId, route.projectId);
        set((s) => ({ workspaces: { ...s.workspaces, [book]: moveTab(s.workspaces[book] ?? EMPTY_WORKSPACE, key, target, after) } }));
      },
      carryWorkspace: (from, to) =>
        set((s) => {
          const tabs = s.workspaces[from];
          const view = s.views[from];
          if (!tabs && !view) return {};
          const { [from]: _moved, ...workspaces } = s.workspaces;
          const { [from]: _view, ...views } = s.views;
          return {
            ...(tabs ? { workspaces: { ...workspaces, [to]: tabs } } : {}),
            ...(view ? { views: { ...views, [to]: view } } : {}),
          };
        }),
      toggleWorkspace: () => {
        const state = get();
        const mode = homeMode(state);
        if (!mode) return;
        const action = tabsButton({ count: mode.count, visible: mode.visible, full: mode.full }).action;
        if (action === 'open') state.openPane({ kind: 'web', id: newId('web'), url: '' });
        else if (action === 'split') exitFull(get, set);
        else if (action === 'hide') set((s) => ({ ...patchView(s, { hidden: true }), hiddenBeforeNarrow: false }));
        else showRemembered(get, set);
      },
      toggleWorkspaceFull: () => {
        const state = get();
        const mode = homeMode(state);
        if (!mode) return;
        if (mode.full) return exitFull(get, set);
        if (!mode.count) return;
        const active = state.route.tab === 'home' && state.route.pane ? itemKey(state.route.pane) : null;
        set((s) => patchView(s, { full: true, hidden: fullViewEntry(mode.visible, active) === CONVERSATION_TAB }));
      },
      showWorkspaceTab: (key, full) => {
        const { route, workspaces, replace } = get();
        if (route.tab !== 'home') return;
        const pane = (workspaces[workspaceKey(route.conversationId, route.projectId)] ?? EMPTY_WORKSPACE).tabs.find((t) => itemKey(t) === key);
        if (!pane) return;
        replace({ ...route, pane });
        set((s) => ({ ...patchView(s, { hidden: false, full }), hiddenBeforeNarrow: false }));
      },
      showConversation: () => set((s) => patchView(s, { hidden: true })),
      revealConversation: () => {
        const state = get();
        const mode = homeMode(state);
        if (!mode) return;
        if (state.workspaceNarrow) state.showConversation();
        else if (mode.full) exitFull(get, set);
      },
      setDockWidth: (width) => set({ dockWidth: clampDock(width) }),
      resizeWorkspace: (width, contentWidth) => {
        if (!Number.isFinite(width) || !Number.isFinite(contentWidth) || contentWidth <= 0) return;
        const next = resizeSplit(width, contentWidth);
        set((s) => ({
          ...(!next.hidden ? { dockWidth: next.width } : {}),
          ...patchView(s, { hidden: next.hidden, full: false }),
          hiddenBeforeNarrow: false,
        }));
      },
      setWebUrl: (book, id, url) => {
        const current = get().workspaces[book];
        if (!current) return;
        const next = updateWebUrl(current, id, url);
        if (next === current) return;
        set((s) => ({ workspaces: { ...s.workspaces, [book]: next } }));
        const { route, replace } = get();
        if (route.tab === 'home' && route.pane?.kind === 'web' && route.pane.id === id && workspaceKey(route.conversationId, route.projectId) === book)
          replace({ ...route, pane: { ...route.pane, url } });
      },
      setWebTitle: (id, title) => set((s) => (s.webTitles[id] === title ? {} : { webTitles: { ...s.webTitles, [id]: title } })),
      setWorkspaceNarrow: (narrow, options = {}) =>
        set((s) => {
          if (s.workspaceNarrow === narrow) return {};
          if (options.initial) return { workspaceNarrow: narrow, hiddenBeforeNarrow: false };
          const hidden = currentView(s).hidden;
          if (narrow) {
            const paneVisible = s.route.tab === 'home' && !!s.route.pane && !hidden;
            const conversation = narrowShowsConversation(!!options.focusInConversation, paneVisible);
            return { workspaceNarrow: true, hiddenBeforeNarrow: hidden, ...(conversation ? patchView(s, { hidden: true }) : {}) };
          }
          return { workspaceNarrow: false, hiddenBeforeNarrow: false, ...patchView(s, { hidden: s.hiddenBeforeNarrow && hidden }) };
        }),
      setModelPage: (category, page) => set((s) => ({ modelPages: { ...s.modelPages, [category]: page } })),
      setSidebarWidth: (width) => set({ sidebarWidth: Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width))) }),
      toggleSidebar: () => set((s) => ({ sidebarHidden: !s.sidebarHidden })),
      setDraft: (key, text) =>
        set((s) => {
          const drafts = { ...s.drafts };
          if (text) drafts[key] = text;
          else delete drafts[key];
          return { drafts };
        }),
      setDraftAccessMode: (key, mode) =>
        set((s) => {
          const draftAccessModes = { ...s.draftAccessModes };
          if (mode) draftAccessModes[key] = mode;
          else delete draftAccessModes[key];
          return { draftAccessModes };
        }),
      setDraftAgent: (key, choice) =>
        set((s) => {
          const draftAgents = { ...s.draftAgents };
          if (choice) draftAgents[key] = choice;
          else delete draftAgents[key];
          return { draftAgents };
        }),
      setQueue: (conversationId, update) =>
        set((s) => {
          const next = update(s.queues[conversationId] ?? []);
          const queues = { ...s.queues };
          if (next.length) queues[conversationId] = next;
          else delete queues[conversationId];
          return { queues };
        }),
      setExpandedProjects: (ids) => set({ expandedProjects: ids }),
      setSidebarGrouping: (sidebarGrouping) => set({ sidebarGrouping }),
      setSidebarSort: (sidebarSort) => set({ sidebarSort }),
      setVideoChat: (key, conversationId) =>
        set((s) => {
          const videoChats = { ...s.videoChats };
          if (conversationId) videoChats[key] = conversationId;
          else delete videoChats[key];
          return { videoChats };
        }),
      setVideoChatMin: (videoChatMin) => set({ videoChatMin }),
      setColorScheme: (colorScheme) => set({ colorScheme }),
      setLanguage: (language) => set({ language }),
      setSpaceView: (spaceView) => set({ spaceView }),
      setSpaceSort: (spaceSort) => set({ spaceSort }),
    }),
    {
      name: 'baocut.shell',
      version: 5,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        sidebarWidth: s.sidebarWidth,
        sidebarHidden: s.sidebarHidden,
        drafts: s.drafts,
        draftAccessModes: s.draftAccessModes,
        expandedProjects: s.expandedProjects,
        sidebarGrouping: s.sidebarGrouping,
        sidebarSort: s.sidebarSort,
        colorScheme: s.colorScheme,
        language: s.language,
        spaceView: s.spaceView,
        spaceSort: s.spaceSort,
        workspaces: s.workspaces,
        views: s.views,
        dockWidth: s.dockWidth,
        modelPages: s.modelPages,
        draftAgents: s.draftAgents,
        queues: s.queues,
        videoChatMin: s.videoChatMin,
      }),
      migrate: (persisted, version) => migrateShell(persisted, version),
    },
  ),
);

/**
 * 1 → 2 只是加了字段：旧值照用，新字段取默认（之后加的字段同理，不必升版本）。
 * 2 → 3：自主模式（plan / controlled / authorized）换成访问模式，并且建好的会话的模式搬进了 Runtime。
 * 旧值不翻译：草稿上的选择丢掉，回到 Runtime 给的初值；不认识的值一律不留（拿不准就问）。
 * 3 → 4：加了新会话草稿上的 Agent 选择（`draftAgents`）与忙时排队（`queues`）；旧数据里没有，取默认。
 * 有这两项时逐条校验，形状不对的丢掉（以后再升版本时，旧数据也经这里清洗）。
 * v4 之内加的 `dockWidth`（会话列宽）、标签组的 `last`（收起前的标签）、`videoChatMin`（悬浮会话最小化）与 `language`（界面语言）都是可缺的字段：旧数据里没有就取默认，不升版本。
 * 4 → 5：功能区的收起与完整视图从全局开关改成每条会话一份（`views`），并记在本机。v4 的全局开关本来就不记在本机，
 * 万一读回里有也丢掉，各会话从默认视图开始；有 `views` 时逐条校验，只留布尔的 `hidden` / `full`。
 */
export function migrateShell(persisted: unknown, version: number): Partial<ShellStore> {
  const state = { ...(persisted as Record<string, unknown>) };
  if (version < 3) delete state.autonomy;
  const modes = state.draftAccessModes;
  state.draftAccessModes =
    modes && typeof modes === 'object'
      ? Object.fromEntries(Object.entries(modes).filter(([, mode]) => (AGENT_MODES as readonly unknown[]).includes(mode)))
      : {};
  if ('draftAgents' in state) state.draftAgents = cleanDraftAgents(state.draftAgents);
  if ('queues' in state) state.queues = cleanQueues(state.queues);
  if ('videoChatMin' in state && typeof state.videoChatMin !== 'boolean') delete state.videoChatMin;
  if ('language' in state && !isLanguagePreference(state.language)) delete state.language;
  delete state.workspaceHidden;
  delete state.workspaceFull;
  if ('views' in state) state.views = cleanViews(state.views);
  return state as Partial<ShellStore>;
}

function cleanViews(value: unknown): Record<string, WorkspaceView> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, raw]) => {
      if (!raw || typeof raw !== 'object') return [];
      const { hidden, full } = raw as Record<string, unknown>;
      const view = { hidden: hidden === true, full: full === true };
      return view.hidden || view.full ? [[key, view]] : [];
    }),
  );
}

/** 当前 Home 位置的视图键；不在 Home 时为 null。 */
function currentKey(s: Pick<ShellStore, 'route'>): string | null {
  return s.route.tab === 'home' ? workspaceKey(s.route.conversationId, s.route.projectId) : null;
}

function currentView(s: Pick<ShellStore, 'route' | 'views'>): WorkspaceView {
  const key = currentKey(s);
  return (key && s.views[key]) || DEFAULT_VIEW;
}

/** 改当前 Home 位置的视图（不在 Home 时不改）；没有变化时返回空补丁。 */
function patchView(s: Pick<ShellStore, 'route' | 'views'>, patch: Partial<WorkspaceView>): Partial<ShellStore> {
  const key = currentKey(s);
  if (!key) return {};
  const old = s.views[key] ?? DEFAULT_VIEW;
  const view = { ...old, ...patch };
  if (view.hidden === old.hidden && view.full === old.full) return {};
  const { [key]: _old, ...rest } = s.views;
  return { views: view.hidden || view.full ? { ...rest, [key]: view } : rest };
}

/**
 * 某个 Home 位置的布局（model/workspace.ts `workspaceMode`）：标签数、功能区是否显示、完整视图、单条标签条、是否选中了会话标签。
 * 不在 Home 时为 null。
 */
export function homeMode(
  s: Pick<ShellStore, 'route' | 'views' | 'workspaces' | 'workspaceNarrow'>,
): (ReturnType<typeof workspaceMode> & { key: string; count: number }) | null {
  const key = currentKey(s);
  if (!key || s.route.tab !== 'home') return null;
  const count = (s.workspaces[key] ?? EMPTY_WORKSPACE).tabs.length;
  const active = s.route.pane ? itemKey(s.route.pane) : null;
  return { key, count, ...workspaceMode({ active, count, view: s.views[key] ?? DEFAULT_VIEW, narrow: s.workspaceNarrow }) };
}

/** 这条会话正在 Home 里、并且看得见（不是单条标签条里选着别的标签）。 */
export function conversationVisible(s: Pick<ShellStore, 'route' | 'views' | 'workspaces' | 'workspaceNarrow'>, conversationId: Id): boolean {
  const mode = homeMode(s);
  return !!mode && s.route.tab === 'home' && s.route.conversationId === conversationId && !(mode.single && mode.visible);
}

type Get = () => ShellStore;
type Set = (partial: Partial<ShellStore> | ((s: ShellStore) => Partial<ShellStore>)) => void;

/** 退出完整视图：会话回到左边，上次的标签回到右边（路由上没有标签时回到收起前或最后一个）。 */
function exitFull(get: Get, set: Set): void {
  set((s) => ({ ...patchView(s, DEFAULT_VIEW), hiddenBeforeNarrow: false }));
  const { route } = get();
  if (route.tab === 'home' && !route.pane) showRemembered(get, set);
}

/** 显示分屏：回到当前、收起前或最后一个标签。 */
function showRemembered(get: Get, set: Set): void {
  const { route, workspaces, go } = get();
  if (route.tab !== 'home') return;
  if (!route.pane) {
    const book = workspaces[workspaceKey(route.conversationId, route.projectId)] ?? EMPTY_WORKSPACE;
    const key = restoreKey(book);
    const pane = book.tabs.find((t) => itemKey(t) === key);
    if (!pane) return;
    go({ ...route, pane });
  }
  set((s) => ({ ...patchView(s, { hidden: false }), hiddenBeforeNarrow: false }));
}

function cleanDraftAgents(value: unknown): Record<string, AgentChoice> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, raw]) => {
      const choice = parseAgentChoice(raw);
      return choice ? [[key, choice]] : [];
    }),
  );
}

function cleanQueues(value: unknown): Record<Id, QueuedMessage[]> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, raw]) => {
      const queue = Array.isArray(raw) ? raw.filter(isQueuedMessage) : [];
      return queue.length ? [[id, queue]] : [];
    }),
  );
}

/** `models` 是设置内部的内容路由，保留它以兼容已有调用方；不对应独立 Rail 入口。 */
export function railTabOf(route: Route): Exclude<Tab, 'models'> {
  return route.tab === 'models' ? 'settings' : route.tab;
}

export function defaultRoute(tab: Tab): Route {
  if (tab === 'home') return HOME;
  if (tab === 'space') return { tab, category: 'all', projectId: null };
  if (tab === 'settings') return { tab, section: 'general' };
  if (tab === 'models') return { tab, category: 'asr' };
  return { tab };
}

/**
 * 进到一个 Home 位置时，那条会话的标签组跟着路由变（当前标签加进去、或收起）。视图（收起、完整视图）按会话各记一份，换会话不改；
 * 路由上没有标签时完整视图照旧，选中的是会话标签。换了会话只忘掉「切到窄窗口之前收起过」。
 */
function arrive(s: ShellStore, route: Route): Partial<ShellStore> {
  if (route.tab !== 'home') return {};
  const book = workspaceKey(route.conversationId, route.projectId);
  const current = s.workspaces[book] ?? EMPTY_WORKSPACE;
  const next = reconcileTabs(current, route.pane);
  const moved = s.route.tab !== 'home' || workspaceKey(s.route.conversationId, s.route.projectId) !== book;
  return {
    ...(next === current ? {} : { workspaces: { ...s.workspaces, [book]: next } }),
    ...(moved ? { hiddenBeforeNarrow: false } : {}),
  };
}

/** Home 功能区开着的视频（Home 的当前标签，或 Space 打开的视频）。 */
export function routeVideo(route: Route): FileTarget | undefined {
  if (route.tab === 'space') return route.video;
  if (route.tab === 'home' && route.pane?.kind === 'video') return route.pane.target;
  return undefined;
}

function sameRoute(a: Route, b: Route): boolean {
  return hrefFor(a) === hrefFor(b);
}

/**
 * 有页面侧栏的入口：标题栏的侧栏开合钮只在这些页出现。打开视频时侧栏还在——视频属于它的入口。
 * 设置（含模型配置）自带分节导航，没有页面侧栏。
 */
export function hasSidebar(route: Route): boolean {
  return route.tab !== 'settings' && route.tab !== 'models';
}

/**
 * 界面内链接：`/home`、`/c/<会话>`、`/p/<项目>`（在这个项目里新建会话），Home 的功能区标签放在查询串里
 * （`?video=` / `?file=` 为 JSON 的 FileTarget，`?files=1`，`?web=<id>&url=<地址>`）；
 * `/space/<分类>[/<项目>][?video=]`、`/settings/<节>`、`/settings/models/<类>[/<页>]`、`/tasks[/<任务>]`、
 * `/services[/<服务>]`、`/tools[/<工具>]`。
 */
export function hrefFor(route: Route): string {
  switch (route.tab) {
    case 'home': {
      const query = route.pane ? `?${paneQuery(route.pane)}` : '';
      if (route.conversationId) return `/c/${route.conversationId}${query}`;
      if (route.projectId) return `/p/${route.projectId}${query}`;
      return `/home${query}`;
    }
    case 'space': {
      const video = route.video ? `?video=${encodeURIComponent(JSON.stringify(route.video))}` : '';
      return (route.projectId ? `/space/${route.category}/${route.projectId}` : `/space/${route.category}`) + video;
    }
    case 'settings':
      return `/settings/${route.section}`;
    case 'models':
      return route.page ? `/settings/models/${route.category}/${route.page}` : `/settings/models/${route.category}`;
    case 'tasks':
      return route.taskId ? `/tasks/${encodeURIComponent(route.taskId)}` : '/tasks';
    case 'services':
      return route.service ? `/services/${encodeURIComponent(route.service)}` : '/services';
    case 'tools':
      return route.tool ? `/tools/${route.tool}` : '/tools';
  }
}

function paneQuery(pane: WorkspaceItem): string {
  if (pane.kind === 'video') return fileTargetQuery('video', pane.target);
  if (pane.kind === 'file') return new URLSearchParams({file:JSON.stringify(pane.target),...(pane.name?{fileName:pane.name}:{})}).toString();
  const query = new URLSearchParams();
  if (pane.kind === 'files') query.set('files', '1');
  else {
    query.set('web', pane.id);
    if (pane.url) query.set('url', pane.url);
  }
  return query.toString();
}

export function parseHref(href: string): Route {
  const [pathPart, queryPart = ''] = href.split('?');
  const [, head, a, b, c] = pathPart!.split('/');
  const query = new URLSearchParams(queryPart);
  const video = parseTarget(query.get('video'));
  const pane = parsePane(query);
  const withPane = (route: Extract<Route, { tab: 'home' }>): Route => (pane ? { ...route, pane } : route);
  if (head === 'c' && a) return withPane({ tab: 'home', conversationId: a, projectId: null });
  if (head === 'p' && a) return withPane({ tab: 'home', conversationId: null, projectId: a });
  if (head === 'home' && pane) return withPane({ tab: 'home', conversationId: null, projectId: null });
  if (head === 'space') {
    const category = SPACE_CATEGORIES.some((c) => c.key === a) ? (a as SpaceCategory) : 'all';
    const route: Route = { tab: 'space', category, projectId: b || null };
    return video ? { ...route, video } : route;
  }
  if (head === 'settings' && a === 'models') {
    const category = isModelCategory(b) ? b : 'asr';
    return isModelPage(c) ? { tab: 'models', category, page: c } : { tab: 'models', category };
  }
  if (head === 'settings') {
    // 旧的模型深链（本地 / 云端 / 我的声音）落到设置内对应模型配置。
    if (a === 'local' || a === 'cloud' || a === 'voices') return { tab: 'models', category: a === 'voices' ? 'tts' : 'asr', page: a };
    // 旧的 `/settings/agent/<页签>`：技能、权限各去新的位置，其余留在 Agent 提供方。
    if (a === 'agent') return { tab: 'settings', section: legacyAgentSection(b) };
    return { tab: 'settings', section: isSettingsSection(a) ? a : 'general' };
  }
  if (head === 'models') {
    const category = isModelCategory(a) ? a : 'asr';
    return isModelPage(b) ? { tab: 'models', category, page: b } : { tab: 'models', category };
  }
  if (head === 'tasks') return a ? { tab: 'tasks', taskId: decodeURIComponent(a) } : { tab: 'tasks' };
  // 远端算力的旧链接在服务页。
  if (head === 'tools' && a === 'remote') return { tab: 'services', service: 'remote' };
  if (head === 'services') return a ? { tab: 'services', service: decodeURIComponent(a) } : { tab: 'services' };
  // 旧版的工具短名（translate、tts……）落到注册表 ID。
  if (head === 'tools') {
    const tool = toolIdOf(a);
    return tool ? { tab: 'tools', tool } : { tab: 'tools' };
  }
  return HOME;
}

function parsePane(query: URLSearchParams): WorkspaceItem | undefined {
  const video = parseTarget(query.get('video'));
  if (video) return { kind: 'video', target: video };
  const file = parseMediaTarget(query.get('file'));
  if (file) return { kind: 'file', target: file, ...(query.get('fileName')?{name:query.get('fileName')!}:{}) };
  if (query.get('files') === '1') return { kind: 'files' };
  const web = query.get('web');
  if (web) return { kind: 'web', id: web, url: query.get('url') ?? '' };
  return undefined;
}

function parseTarget(value: string | null): FileTarget | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.entryId === 'string') return { entryId: parsed.entryId };
    if (typeof parsed.path !== 'string') return undefined;
    if (typeof parsed.projectId === 'string') return { projectId: parsed.projectId, path: parsed.path };
    if (typeof parsed.conversationId === 'string') return { conversationId: parsed.conversationId, path: parsed.path };
  } catch {
    // 看不懂的链接当作没有这个标签。
  }
  return undefined;
}

function parseMediaTarget(value:string|null):MediaTarget|undefined {
  const file=parseTarget(value);if(file)return file;
  try {const p=JSON.parse(value??'null');if(p&&typeof p.conversationId==='string'&&typeof p.attachmentId==='string')return {conversationId:p.conversationId,attachmentId:p.attachmentId};
    if(p&&typeof p.videoId==='string'&&typeof p.assetId==='string')return {videoId:p.videoId,assetId:p.assetId,...(typeof p.revision==='number'?{revision:p.revision}:{})};
  }catch{}return undefined;
}
