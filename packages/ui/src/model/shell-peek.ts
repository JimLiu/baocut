import type { FileTarget, MediaTarget, SpaceEntry } from '@baocut/protocol';
import type { Route, Tab } from '../state/shell-store.ts';
import { entryOfTarget, type WorkspaceItem } from './workspace.ts';

/**
 * 侧栏浮出与页签缩略卡的纯逻辑（产品设计 §2.5「侧栏浮出」、§3.3「页签条」；原型 home-shell-chrome.jsx
 * `useShellPeek`、`WorkspaceTabPreview`）。计时、关闭判定与位置都在这里，组件只接 DOM 事件。
 */

/** 指针在 Rail 入口或侧栏开关上停多久才浮出，以及离开浮层与入口多久后关闭。 */
export const PEEK_DELAY_MS = 100;
/** 指针在页签上停多久显示缩略卡。 */
export const TAB_PREVIEW_DELAY_MS = 500;
/** 浮层距应用面板上、下、左缘的内缩。 */
export const PEEK_INSET = 6;
/** 缩略卡的宽度与它离视口边缘、离页签的距离。 */
export const TAB_PREVIEW_WIDTH = 280;
export const TAB_PREVIEW_MARGIN = 8;

/** 能浮出的侧栏：Home、Space，以及工具、服务、后台任务共用的那一种。 */
export type PeekKind = Exclude<Tab, 'settings' | 'models'>;

/** Rail 入口对应的侧栏；设置（含模型页）没有页面侧栏，不浮出。 */
export function peekKindOf(tab: Tab): PeekKind | null {
  return tab === 'settings' || tab === 'models' ? null : tab;
}

/** 浮出的是不是当前所在的区域（模型页属于设置）。 */
export function isCurrentPeek(kind: PeekKind, route: Route): boolean {
  return (route.tab === 'models' ? 'settings' : route.tab) === kind;
}

/**
 * 浮层以哪个路由为上下文渲染：浮出的就是当前区域时用当前路由，别的区域用点它的 Rail 入口会去的地方
 * （`target`：上次停留的位置，没有就是该入口的默认页，同 `goTab`）。
 */
export function peekRoute(kind: PeekKind, route: Route, target: Route): Route {
  return isCurrentPeek(kind, route) ? route : target;
}

/**
 * 浮层里的导航先关浮层再执行（原型 `ShellPeek` 的 `closing`）。不能只靠「路由变化时关闭」：去的就是当前路由时
 * （新建会话已在新会话页、项目菜单「在此项目中新建会话」已在该项目）store 的 `go` 什么也不改，浮层就会一直开着。
 */
export function closingFirst<A extends unknown[]>(closePeek: () => void, action: (...args: A) => void): (...args: A) => void {
  return (...args) => {
    closePeek();
    action(...args);
  };
}

/** 浮层的固定定位：应用面板（内容区）矩形的上、下、左各内缩 6。 */
export function peekBox(sheet: { left: number; top: number; bottom: number }, viewportHeight: number) {
  return { left: sheet.left + PEEK_INSET, top: sheet.top + PEEK_INSET, bottom: viewportHeight - sheet.bottom + PEEK_INSET };
}

/** 落在这些地方的按下不关浮层：浮层本身、Rail、标题栏导航区、菜单与对话框（含 React Aria 弹层的底板）。 */
export const PEEK_KEEP_SELECTOR =
  '[data-shell-peek], [data-shell-peek-keep], [role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"], [data-rac][role="presentation"]';

/** 打开着这些弹层时，指针离开不关浮层、Esc 也不由浮层处理。提示条（Toast）的 alertdialog 在提示区里，不算。 */
export const PEEK_OVERLAY_SELECTOR = '[role="menu"], [role="dialog"], [role="alertdialog"]';

/** 一次按下要不要关浮层：目标在保留区域之内就不关。 */
export function closesPeekOnPointerDown(target: { closest(selector: string): unknown } | null): boolean {
  return !target?.closest(PEEK_KEEP_SELECTOR);
}

/**
 * 指针离开浮层与入口 100 ms 后是否关闭：浮层里有焦点、或开着菜单 / 对话框 / 确认框时不关。
 */
export function peekStaysOpen({ focusInside, overlayOpen }: { focusInside: boolean; overlayOpen: boolean }): boolean {
  return focusInside || overlayOpen;
}

/** 缩略卡的位置：左缘对齐页签、夹在视口里（两侧各留 8），顶在页签下方 8。 */
export function tabPreviewPosition(tab: { left: number; bottom: number }, viewportWidth: number) {
  const max = viewportWidth - TAB_PREVIEW_WIDTH - TAB_PREVIEW_MARGIN;
  return { left: Math.max(TAB_PREVIEW_MARGIN, Math.min(tab.left, max)), top: tab.bottom + TAB_PREVIEW_MARGIN };
}

/**
 * 缩略卡的副标题：网页写地址（空白页写「新标签页」），文件与视频写项目内路径，会话页签写「会话」；
 * 找不到路径时用标题。文字由调用方按当前语言给。
 */
export function tabPreviewSubtitle(
  item: WorkspaceItem | 'conversation',
  { title, conversation, newTab, entries }: { title: string; conversation: string; newTab: string; entries: readonly SpaceEntry[] },
): string {
  if (item === 'conversation') return conversation;
  if (item.kind === 'web') return item.url || newTab;
  if (item.kind === 'files') return title;
  return targetPath(item.target, entries) || title;
}

function targetPath(target: FileTarget | MediaTarget, entries: readonly SpaceEntry[]): string {
  if ('path' in target) return target.path;
  if ('entryId' in target) return entryOfTarget(entries, target)?.relPath ?? '';
  return '';
}
