import { MAIN_CHANNEL_ID, type Id } from '@baocut/protocol';

/**
 * Bot 页右栏的页签与宽度（需求 §11.1、§11.6 的修订稿，原型 model-bot.js「右栏页签」「右栏宽度」）：右栏照 Home 的功能区
 * （产品设计 §3.3）是一组页签。频道里最前面是「任务」「Make」两个固定页签（也能关），后面是打开的任务与产物。
 * 页签簿 {tabs, active} 按频道各记一份、收件箱一份（它没有固定页签）；路由的 workItemId（再带 output 时是它的一个产物）指当前的
 * 任务或产物页签，没有就是 active: null，显示固定页签。组件只管画，规则都在这里。
 */

export type FixedSideTab = 'tasks' | 'make';

/** 打开的任务，或任务的一个产物（`output` 是 `outputKey`：按引用取，不用下标——Runtime 合并产物时去重、只留最近的，下标会挪）。 */
export type BotSideTab = { key: string; kind: 'task'; workItemId: Id } | { key: string; kind: 'output'; workItemId: Id; output: string };

export interface SideTabs {
  tabs: BotSideTab[];
  active: string | null;
}

export const EMPTY_SIDE_TABS: SideTabs = { tabs: [], active: null };

/** 主区窄于这个宽度时只剩一栏（原型 page-bot.jsx `NARROW`）。 */
export const BOT_NARROW = 880;

/** 页签簿的键：频道 id（没有就是默认频道），收件箱是 'inbox'。 */
export function sideTabBook(route: { channelId: Id | null; view: string }): string {
  return route.view === 'inbox' ? 'inbox' : (route.channelId ?? MAIN_CHANNEL_ID);
}

/** 路由里的页签：带产物是那个任务的这个产物，只带任务是任务，没有是 null（固定页签）。 */
export function sideTabFromRoute(workItemId: Id | null, output?: string | null): BotSideTab | null {
  if (!workItemId) return null;
  return output
    ? { key: `out:${workItemId}:${output}`, kind: 'output', workItemId, output }
    : { key: `task:${workItemId}`, kind: 'task', workItemId };
}

/** 打开一个页签并选中：已开的就选中它，没开的开在最后。 */
export function openSideTab(state: SideTabs, tab: BotSideTab): SideTabs {
  const has = state.tabs.some((t) => t.key === tab.key);
  if (has && state.active === tab.key) return state;
  return { tabs: has ? state.tabs : [...state.tabs, tab], active: tab.key };
}

/** 关掉一个页签；关的是当前的就选它右边那个（最后一个就选左边），一个不剩是 null。 */
export function closeSideTab(state: SideTabs, key: string): SideTabs {
  const index = state.tabs.findIndex((t) => t.key === key);
  if (index < 0) return state;
  const tabs = state.tabs.filter((t) => t.key !== key);
  return { tabs, active: state.active === key ? (tabs[Math.min(index, tabs.length - 1)]?.key ?? null) : state.active };
}

/** 按路由对齐一份页签簿：路由里的任务没开就开在最后并选中；路由里没有就选固定页签，已开的都留着。没变时原样返回。 */
export function reconcileSideTabs(state: SideTabs | undefined, tab: BotSideTab | null): SideTabs {
  const s = state ?? EMPTY_SIDE_TABS;
  if (tab) return openSideTab(s, tab);
  return s.active === null ? s : { ...s, active: null };
}

/** 频道里排在最前的两个页签。它们也能关，频道头的开关按这个顺序插回去。 */
export const FIXED_SIDE_TABS: readonly FixedSideTab[] = ['tasks', 'make'];

/** 打开（插回）一个固定页签，保持「任务」「Make」的顺序。 */
export function openFixedTab(open: readonly FixedSideTab[], kind: FixedSideTab): FixedSideTab[] {
  return FIXED_SIDE_TABS.filter((k) => k === kind || open.includes(k));
}

/**
 * 关掉正选着的固定页签后选谁：照关页签的规矩选它右边那个（另一个固定页签或第一个打开的页签），没有就左边；
 * 一个不剩是 null（右栏收起，窄时回到频道）。返回页签键，固定页签是 `fixed:tasks` / `fixed:make`。
 */
export function afterFixedClose(open: readonly FixedSideTab[], kind: FixedSideTab, tabs: readonly BotSideTab[]): string | null {
  const order = [...open.map((k) => `fixed:${k}`), ...tabs.map((t) => t.key)];
  const at = order.indexOf(`fixed:${kind}`);
  if (at < 0) return null;
  const rest = order.filter((_, i) => i !== at);
  return rest[Math.min(at, rest.length - 1)] ?? null;
}

/** 右栏的形态（定宽用）：产物、任务详情，或固定页签自己。 */
export type SideMode = FixedSideTab | 'detail' | 'output';

export function sideMode(active: BotSideTab | null, fixed: FixedSideTab): SideMode {
  return active ? (active.kind === 'output' ? 'output' : 'detail') : fixed;
}

/** 右栏能拖的范围：至少 300，中间至少留 360。 */
export const SIDE_MIN = 300;
export const CENTER_MIN = 360;

/**
 * 右栏各形态的默认宽：任务面板 340、Make 380；任务详情占主区的 45%（480–640）；产物（视频编辑器、文档……）把中间压到 440 左右，
 * 至少 560。
 */
export function sideDefault(mode: SideMode, available: number): number {
  if (mode === 'make') return 380;
  if (mode === 'detail') return Math.min(640, Math.max(480, Math.round(available * 0.45)));
  if (mode === 'output') return Math.max(560, available - 440);
  return 340;
}

export interface SeamRange {
  width: number;
  min: number;
  max: number;
}

/** 实际宽：拖过的用拖过的，否则用默认；都夹在 [300, 主区 − 360] 里。 */
export function sideWidth(mode: SideMode, stored: number | undefined, available: number): SeamRange {
  const max = Math.max(SIDE_MIN, available - CENTER_MIN);
  const want = stored ?? sideDefault(mode, available);
  return { width: Math.round(Math.min(max, Math.max(SIDE_MIN, want))), min: SIDE_MIN, max };
}

/** 占满时左栏放什么：任务列表、Make、收件箱，或产物所属的任务（`task`）。 */
export type FullLeft = FixedSideTab | 'inbox' | 'task';

/**
 * 右栏占满（中间收起）时的两栏：左边是当前页签的上一层，右边是当前页签。
 * 产物 → 它的任务 | 产物；任务 → 任务列表（收件箱里是收件箱）| 任务；固定页签 → 它自己 | 提示。
 */
export function fullColumns(active: BotSideTab | null, fixed: FixedSideTab, inbox: boolean): { left: FullLeft; right: BotSideTab | null } {
  if (active?.kind === 'output') return { left: 'task', right: active };
  if (active) return { left: inbox ? 'inbox' : 'tasks', right: active };
  return { left: inbox ? 'inbox' : fixed, right: null };
}

/** 占满时左栏的默认宽：任务列表 340、Make 380、收件箱 360、任务 440；右栏至少留 480。 */
const FULL_LEFT: Record<FullLeft, number> = { tasks: 340, make: 380, inbox: 360, task: 440 };
export const FULL_RIGHT_MIN = 480;

export function fullSplit(left: FullLeft, stored: number | undefined, available: number): SeamRange {
  const max = Math.max(SIDE_MIN, available - FULL_RIGHT_MIN);
  const want = stored ?? FULL_LEFT[left];
  return { width: Math.round(Math.min(max, Math.max(SIDE_MIN, want))), min: SIDE_MIN, max };
}

export interface BotBarInput {
  /** 标题栏的左缘与宽（视口坐标）。 */
  origin: number;
  width: number;
  /** 后退、前进与侧栏开合钮的右缘：标题栏里的东西至少离开它 12。 */
  navRight: number;
  content: { left: number; right: number } | null;
  main: { left: number; right: number } | null;
  side: { left: number; right: number } | null;
  shown: boolean;
  single: boolean;
}

/** 中间栏的标题窄于这个宽度就不放进标题栏（原型 page-bot.jsx `headWidth >= 160`）。 */
export const BOT_HEAD_MIN = 160;

/**
 * Bot 页标题栏里两样东西的位置（相对标题栏左缘；原型 page-bot.jsx `useTitlebarSlot` 之后那几行）：
 * 中间栏的标题从中间栏左缘排到右栏左缘（右栏收起时到中间栏右缘），太窄就不放；
 * 页签条从右栏左缘排到标题栏右缘前 8，窄时（`single`）从 Bot 页左缘开始，那时标题回到中间栏顶上。
 * 都让开后退前进 12；`divider` 是不占满时右栏左缘那根竖线。
 */
export function botBarBounds(input: BotBarInput): {
  head: { left: number; width: number } | null;
  strip: { left: number; right: number } | null;
  divider: boolean;
} {
  const { origin, width, navRight, content, main, side, shown, single } = input;
  if (!content) return { head: null, strip: null, divider: false };
  const floor = Math.max(content.left - origin, navRight - origin + 12);
  const end = Math.min(content.right - origin, width - 8);
  let head: { left: number; width: number } | null = null;
  if (!single && main) {
    const left = Math.max(main.left - origin, floor);
    const right = (shown && side ? Math.min(side.left, main.right) : main.right) - origin;
    if (right - left >= BOT_HEAD_MIN) head = { left: Math.round(left), width: Math.round(right - left) };
  }
  const stripLeft = single ? floor : shown && side ? Math.max(side.left - origin, floor) : null;
  const strip = stripLeft === null ? null : { left: Math.round(stripLeft), right: Math.round(Math.max(8, width - end)) };
  return { head, strip, divider: !!strip && !single && !!main };
}
