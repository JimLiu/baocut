import { defineMessages, type FileTarget, type MediaTarget, type Id, type SpaceEntry } from '@baocut/protocol';
import { zhHans } from './workspace.zh-Hans.ts';
import { zhHant } from './workspace.zh-Hant.ts';
import { ja } from './workspace.ja.ts';
import { ko } from './workspace.ko.ts';
import { es } from './workspace.es.ts';
import { fr } from './workspace.fr.ts';
import { de } from './workspace.de.ts';
import { nl } from './workspace.nl.ts';
import { ptBR } from './workspace.pt-BR.ts';
import { it } from './workspace.it.ts';
import { ru } from './workspace.ru.ts';
import { pl } from './workspace.pl.ts';
import { tr } from './workspace.tr.ts';
import { vi } from './workspace.vi.ts';

/** 标签名的兜底文案（译文在 `workspace.<语言>.ts`）。 */
const en = { newTab: 'New tab', projectFiles: 'Project files', videoUnavailable: 'Video unavailable', fileUnavailable: 'File unavailable' };
export type WorkspaceMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * Home 功能区的标签页（产品设计 §2.5、§3.3 用户修订）：视频、单个文件、项目文件浏览、网页。
 * 每条会话各自记着一组标签；路由只带当前那一个。预览不改变会话的写入目标。
 */
export type WorkspaceItem =
  | { kind: 'video'; target: FileTarget }
  | { kind: 'file'; target: MediaTarget; name?:string }
  | { kind: 'files' }
  | { kind: 'web'; id: string; url: string };

export interface WorkspaceTabs {
  tabs: WorkspaceItem[];
  /** 当前标签的 key；null 表示功能区收起（会话独占主区）。 */
  active: string | null;
  /** 收起前最后一个当前标签：「显示右侧区域」时回到它（原型 home-workspace-store.jsx `remembered`）。 */
  last?: string;
}

export const EMPTY_WORKSPACE: WorkspaceTabs = { tabs: [], active: null };

/** 新会话（还没说第一句）的工作区键：在某个项目里，或不属于项目。 */
export function workspaceKey(conversationId: Id | null, projectId: Id | null): string {
  if (conversationId) return conversationId;
  return projectId ? `new:${projectId}` : 'new';
}

export function itemKey(item: WorkspaceItem): string {
  switch (item.kind) {
    case 'video':
      return `video:${targetKey(item.target)}`;
    case 'file':
      return `file:${targetKey(item.target)}`;
    case 'files':
      return 'files';
    case 'web':
      return `web:${item.id}`;
  }
}

export function targetKey(target: MediaTarget): string {
  if ('attachmentId' in target) return `a:${target.conversationId}:${target.attachmentId}`;
  if ('assetId' in target) return `v:${target.videoId}:${target.assetId}:${target.revision??''}`;
  if ('entryId' in target) return `e:${target.entryId}`;
  if ('projectId' in target) return `p:${target.projectId}:${target.path}`;
  return `c:${target.conversationId}:${target.path}`;
}

/** 打开（或换到）一个标签：已有同 key 的就地更新，否则排到最后。 */
export function openTab(state: WorkspaceTabs, item: WorkspaceItem): WorkspaceTabs {
  const key = itemKey(item);
  const exists = state.tabs.some((t) => itemKey(t) === key);
  return {
    tabs: exists ? state.tabs.map((t) => (itemKey(t) === key ? item : t)) : [...state.tabs, item],
    active: key,
  };
}

/**
 * 原地换掉一个标签（原型 model-home-workspace.js `replace`）：新标签放在 `key` 的位置并成为当前标签，像浏览器在同一个标签页里换页面；
 * 新标签已在别处打开时挪过来，不留两份。没有 `key` 这个标签时等于 `openTab`。
 */
export function replaceTab(state: WorkspaceTabs, key: string, item: WorkspaceItem): WorkspaceTabs {
  if (!state.tabs.some((t) => itemKey(t) === key)) return openTab(state, item);
  const next = itemKey(item);
  const tabs = state.tabs.filter((t) => itemKey(t) !== next || itemKey(t) === key).map((t) => (itemKey(t) === key ? item : t));
  return { tabs, active: next };
}

/** 关掉一个标签：关的是当前标签时，同一位置的下一个（没有就前一个）接上。 */
export function closeTab(state: WorkspaceTabs, key: string): WorkspaceTabs {
  const index = state.tabs.findIndex((t) => itemKey(t) === key);
  if (index < 0) return state;
  const tabs = state.tabs.filter((_, i) => i !== index);
  const next = tabs[Math.min(index, tabs.length - 1)];
  const active = state.active === key ? (next ? itemKey(next) : null) : state.active;
  return state.last && state.last !== key ? { tabs, active, last: state.last } : { tabs, active };
}

/** 把 `key` 挪到 `targetKey` 的前面（`after` 时后面）。 */
export function moveTab(state: WorkspaceTabs, key: string, target: string, after = false): WorkspaceTabs {
  if (key === target) return state;
  const item = state.tabs.find((t) => itemKey(t) === key);
  if (!item || !state.tabs.some((t) => itemKey(t) === target)) return state;
  const tabs = state.tabs.filter((t) => t !== item);
  tabs.splice(tabs.findIndex((t) => itemKey(t) === target) + (after ? 1 : 0), 0, item);
  return tabs.every((t, i) => t === state.tabs[i]) ? state : { ...state, tabs };
}

/** 有没有哪条会话的标签组还开着这个视频（`key` 是 `targetKey`）：没有了才真正关掉它。 */
export function isVideoReferenced(workspaces: Record<string, WorkspaceTabs>, key: string): boolean {
  return Object.values(workspaces).some((book) => book.tabs.some((t) => t.kind === 'video' && targetKey(t.target) === key));
}

/** 路由换到这条会话的某个标签（或没有标签）时，标签组跟着变；收起时记下刚才的标签。没有变化时返回原对象。 */
export function reconcileTabs(state: WorkspaceTabs, pane: WorkspaceItem | undefined): WorkspaceTabs {
  const next = pane ? openTab(state, pane) : state.active === null ? state : { tabs: state.tabs, active: null, last: state.active };
  return JSON.stringify(next) === JSON.stringify(state) ? state : next;
}

/** 「显示右侧区域」回到哪个标签：当前的，收起前的，都没有就最后一个（原型 `toggleWorkspace`）。 */
export function restoreKey(state: WorkspaceTabs): string | null {
  const has = (key: string | null | undefined): key is string => !!key && state.tabs.some((t) => itemKey(t) === key);
  if (has(state.active)) return state.active;
  if (has(state.last)) return state.last;
  const tail = state.tabs.at(-1);
  return tail ? itemKey(tail) : null;
}

/**
 * 地址栏的输入变成一个可以打开的网址；不是网址时返回 null（由调用方改成搜索）。
 * 只允许 http/https，去掉账号密码以外的写法一律拒绝；localhost 与 `主机:端口` 补上协议。
 */
export function safeUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(text);
    const hostPort = /^[^\s/:?#]+\.[^\s/:?#]+:\d+(?:[/?#]|$)/.test(text);
    const url = new URL(
      local ? `http://${text}` : hostPort ? `https://${text}` : /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`,
    );
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** 网页标签的名字：主机名；还没有地址时是「新标签页」。 */
export function webTitle(url: string): string {
  try {
    return new URL(url).hostname || M.newTab;
  } catch {
    return M.newTab;
  }
}

export interface TabRect {
  key: string;
  left: number;
  width: number;
}

/** 拖动标签时落在哪：按未变换的槽位判断，动画中的邻居不会把目标挤走。 */
export function dragTarget(rects: TabRect[], key: string, x: number): { key: string; after: boolean } | null {
  const others = rects.filter((r) => r.key !== key);
  if (!others.length) return null;
  const next = others.find((r) => x < r.left + r.width / 2);
  return next ? { key: next.key, after: false } : { key: others.at(-1)!.key, after: true };
}

/** 拖动预览里每个标签要平移多少，才能排成放下之后的顺序。 */
export function dragOffsets(
  rects: TabRect[],
  key: string,
  target: { key: string; after: boolean } | null,
  gap = 4,
): Record<string, number> {
  if (!target || !rects.length) return {};
  const from = rects.findIndex((r) => r.key === key);
  const to = rects.findIndex((r) => r.key === target.key);
  if (from < 0 || to < 0) return {};
  const order = rects.filter((r) => r.key !== key);
  order.splice(order.findIndex((r) => r.key === target.key) + (target.after ? 1 : 0), 0, rects[from]!);
  let left = rects[0]!.left;
  const offsets: Record<string, number> = {};
  for (const rect of order) {
    offsets[rect.key] = left - rect.left;
    left += rect.width + gap;
  }
  return offsets;
}

/** 会话列至少 320，默认 380；最大宽度由工作区决定，中缝双击回到默认。 */
export const DOCK_MIN = 320;
export const DOCK_DEFAULT = 380;
export const PANE_MIN_WIDTH = 320;
export const PANE_HIDE_WIDTH = PANE_MIN_WIDTH / 2;

export function clampDock(width: number): number {
  return Number.isFinite(width) ? Math.round(Math.max(DOCK_MIN, width)) : DOCK_DEFAULT;
}

/** 正常分栏保留右侧最小宽度，实际指针仍可越过这个边界（product-design §3.3）。 */
export function dockFor(contentWidth: number, dock: number): number {
  return Math.max(DOCK_MIN, Math.min(clampDock(dock), contentWidth - PANE_MIN_WIDTH));
}

export function resizeSplit(conversationWidth: number, contentWidth: number): { width: number; hidden: boolean } {
  return { width: dockFor(contentWidth, conversationWidth), hidden: contentWidth - conversationWidth < PANE_HIDE_WIDTH };
}

/** 编辑器最小宽度：工具栏 68 + 缝 7 + 面板 300 + 预览 320。 */
export const EDITOR_MIN_WIDTH = 695;

/**
 * 窄模式只由容器宽度决定，不能随拖宽的会话列切换，否则拖动会在收起阈值前中断。
 * 原型用 960px 近似；应用按最窄会话 320 + 实际编辑器 695 预留（product-design §3.3）。
 */
export function isNarrow(contentWidth: number): boolean {
  return Number.isFinite(contentWidth) && contentWidth > 0 && contentWidth < DOCK_MIN + EDITOR_MIN_WIDTH;
}

/**
 * 并排切到单列的那一刻选哪个标签（原型 `narrowShowsConversation`）：焦点在会话区里，或功能区本来就收起时选会话；
 * 否则停在正在用的标签。
 */
export function narrowShowsConversation(focusInConversation: boolean, paneVisible: boolean): boolean {
  return focusInConversation || !paneVisible;
}

/** 标签上的名字（原型 model-home-workspace.js `title`）：项目文件、网页标题（还没有时用主机名），或文件与视频的名字。 */
export function workspaceTitle(item: WorkspaceItem, name?: string | null): string {
  if (item.kind === 'files') return M.projectFiles;
  if (item.kind === 'web') return name || webTitle(item.url);
  if (name) return name;
  if (item.kind==='file'&&item.name) return item.name;
  const path = 'path' in item.target ? item.target.path.replace(/\/+$/, '') : '';
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base || (item.kind === 'video' ? M.videoUnavailable : M.fileUnavailable);
}

/** 网页标签里的页面换了地址：就地改这个标签的 `url`，不改当前标签与顺序；没有这个标签或没变化时返回原对象。 */
export function updateWebUrl(state: WorkspaceTabs, id: string, url: string): WorkspaceTabs {
  const index = state.tabs.findIndex((t) => t.kind === 'web' && t.id === id);
  const tab = state.tabs[index];
  if (!tab || tab.kind !== 'web' || tab.url === url) return state;
  const tabs = state.tabs.slice();
  tabs[index] = { ...tab, url };
  return { ...state, tabs };
}

/** 标签对应的 Space 条目：按条目 id，或按来源目录加相对路径。 */
export function entryOfTarget(entries: readonly SpaceEntry[], target: MediaTarget): SpaceEntry | undefined {
  if ('entryId' in target) return entries.find((e) => e.id === target.entryId);
  if ('projectId' in target) return entries.find((e) => e.source.projectId === target.projectId && e.relPath === target.path);
  return 'path' in target ? entries.find((e) => e.source.conversationId === target.conversationId && e.relPath === target.path) : undefined;
}

/** 标签条的方向键：左右循环，Home / End 到两头；别的键返回 null。 */
export function tabKeyIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index + count - 1) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/**
 * 窄窗口与完整视图里会话那个固定的第一个标签（产品设计 §2.5、§3.3）。它不在 `tabs` 里：挪动、关闭与路由都看不到它。
 */
export const CONVERSATION_TAB = '__conversation__';

/** 每条会话（新会话按草稿键）自己的视图：功能区收起（会话标签选中）与完整视图。 */
export interface WorkspaceView {
  hidden: boolean;
  full: boolean;
}

export const DEFAULT_VIEW: WorkspaceView = { hidden: false, full: false };

/**
 * 三种布局（产品设计 §2.5、§3.3 用户修订）：会话（功能区收起）、分屏（会话在左、标签在右）、完整视图（一条标签条，会话是固定的第一格）。
 * 窄窗口与完整视图共用单条标签条（`single`）；单条标签条里没显示标签就是选中了会话标签（`conversation`）。
 * 完整视图要有标签：没有标签时即使记着 `full` 也不算。
 */
export function workspaceMode(input: { active: string | null; count: number; view: WorkspaceView; narrow: boolean }): {
  visible: boolean;
  full: boolean;
  single: boolean;
  conversation: boolean;
} {
  const visible = !!input.active && !input.view.hidden;
  const full = input.view.full && input.count > 0;
  const single = input.narrow || full;
  return { visible, full, single, conversation: single && !visible };
}

/** 进入完整视图时选哪一格：保留屏幕上的样子，显示着的标签继续选中，否则选会话标签。 */
export function fullViewEntry(paneVisible: boolean, active: string | null): string {
  return paneVisible && active ? active : CONVERSATION_TAB;
}

export type TabsButtonAction = 'open' | 'split' | 'hide' | 'show';

/** 标题栏「标签页」按钮的样子与动作。 */
export interface TabsButtonState {
  action: TabsButtonAction;
  /** `tabs-plus`：标签框里一个小加号；`hide-tabs`：隐藏标签页图标；`count`：标签框里是标签数。 */
  glyph: 'tabs-plus' | 'hide-tabs' | 'count';
  /** 只在 `count` 时有：框里的数字，九个以上写「9+」。 */
  badge?: string;
  /** 只有 `count`（分屏收起）时悬停才列出已打开的标签页。 */
  listed: boolean;
}

/**
 * 「标签页」按钮（标题栏右侧按钮组最右）：没有标签时打开新标签页；完整视图里回到分屏；分屏显示着时隐藏标签页；
 * 分屏收起时显示标签数，点了显示标签页，悬停列出已打开的标签页。
 */
export function tabsButton({ count, visible, full }: { count: number; visible: boolean; full: boolean }): TabsButtonState {
  if (!count) return { action: 'open', glyph: 'tabs-plus', listed: false };
  if (full) return { action: 'split', glyph: 'hide-tabs', listed: false };
  if (visible) return { action: 'hide', glyph: 'hide-tabs', listed: false };
  return { action: 'show', glyph: 'count', badge: count > 9 ? '9+' : String(count), listed: true };
}

/** 分屏显示着时会话摘要跟着会话列，挂在会话头的 ··· 之后；收起、完整视图与窄窗口时它是右侧按钮组的第一个。 */
export function summaryInHead({ visible, single, count }: { visible: boolean; single: boolean; count: number }): boolean {
  return visible && !single && count > 0;
}

export interface HomeBarInput {
  /** 标题栏左缘。 */
  origin: number;
  /** 标题栏宽度。 */
  width: number;
  /** 后退前进那组按钮的右缘。 */
  navRight: number;
  /** Home 内容区（会话侧栏右边）的左右缘；还没量到时为 null。 */
  content: { left: number; right: number } | null;
  /** 会话列的右缘；会话列不在旁边（完整视图、窄窗口）时为 null。 */
  conversationRight: number | null;
  /** 右侧视图按钮组的左缘；按钮组是空的（宽度为 0）时为 null。 */
  controlsLeft: number | null;
  /** 右侧区域正显示着。 */
  hasPane: boolean;
  /** 单条标签条：窄窗口或完整视图。 */
  single: boolean;
}

/**
 * Home 标题栏的分界：会话头从内容区左缘（至少离开后退前进 12px）排到 `split`，标签条从 `split` 排到离右缘 `right` 处。
 * 右侧显示着时 `split` 对齐会话列的缝；单条标签条（会话是标签条的第一格）时标签条从左缘开始；
 * 没有右侧区域时会话头排到按钮组左缘前 4px，··· 与按钮组读作一组。按钮组的宽度随按钮数变化，所以量它的实际左缘。
 */
export function homeBarBounds(input: HomeBarInput): { left: number; split: number; right: number } | null {
  const { origin, width, navRight, content, conversationRight, controlsLeft, hasPane, single } = input;
  if (!content) return null;
  const left = Math.max(content.left - origin, navRight - origin + 12);
  const end = Math.min(content.right - origin, (controlsLeft === null ? origin + width : controlsLeft) - origin - 4);
  const split = single
    ? left
    : hasPane
      ? conversationRight === null
        ? // 会话列刚出现、还没量到：先粗排，量到后对齐。
          left + Math.min(240, (end - left) * 0.4)
        : conversationRight - origin
      : end;
  return { left: Math.round(left), split: Math.round(Math.max(left, split)), right: Math.round(Math.max(8, width - end)) };
}
