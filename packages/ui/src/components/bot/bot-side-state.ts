import { useMemo } from 'react';
import { MAIN_CHANNEL_ID, type Channel, type Id } from '@baocut/protocol';
import {
  BOT_NARROW,
  afterFixedClose,
  closeSideTab,
  openFixedTab,
  reconcileSideTabs,
  sideMode,
  sideTabBook,
  sideTabFromRoute,
  type BotSideTab,
  type FixedSideTab,
  type SideMode,
  type SideTabs,
} from '../../model/bot-side.ts';
import { fixedTabs, useBotLayout } from '../../state/bot-layout-store.ts';
import { useChannelSummary } from '../../state/channels-store.ts';
import { useShell, type BotView } from '../../state/shell-store.ts';

export interface BotRouteView {
  channelId: Id | null;
  workItemId: Id | null;
  view: BotView;
  output?: string;
}

const NO_FIXED: readonly FixedSideTab[] = [];

export interface BotSide {
  bookKey: string;
  inbox: boolean;
  channel: Channel | null;
  /** 路由对齐后的页签簿：BotPage 把它写回 store（`tabs !== stored` 时）。 */
  tabs: SideTabs;
  stored: SideTabs | undefined;
  active: BotSideTab | null;
  fixedOpen: readonly FixedSideTab[];
  /** 没有任务或产物页签选着时显示的固定页签：上次选的那个，关掉了就换开着的另一个；一个不剩是 null。 */
  sideKind: FixedSideTab | null;
  narrow: boolean;
  /** 只剩一栏：窄，且这一页有右栏（记忆页没有）。 */
  single: boolean;
  shown: boolean;
  full: boolean;
  mode: SideMode;
  /** 这个频道里等你的任务数、没处理的建议数（页签与频道头的开关带点）。 */
  waiting: number;
  suggestions: number;
  selectFixed(kind: FixedSideTab): void;
  hide(): void;
  selectTab(tab: BotSideTab): void;
  closeTab(tab: BotSideTab): void;
  closeFixed(kind: FixedSideTab): void;
  toggleFull(): void;
}

/**
 * Bot 页右栏的状态与动作（原型 page-bot.jsx `BotPage` 的前半段）：BotPage 画右栏，BotTitleBar 画中间栏的标题与页签条，
 * 两边按同一个路由各调一次，读同一份 store（bot-layout-store），所以算出来的一样。动作直接改 store 与路由。
 * 右栏的开合：宽时默认开着，窄时默认收起；路由里有任务时总是开着。收件箱没有固定页签，只在打开了任务时显示右栏。
 */
export function useBotSide({ channelId: routeChannelId, workItemId, view, output }: BotRouteView): BotSide {
  const inbox = view === 'inbox';
  const bookKey = sideTabBook({ channelId: routeChannelId, view });
  const summary = useChannelSummary(inbox ? null : (routeChannelId ?? MAIN_CHANNEL_ID));
  const channel = summary?.channel ?? null;
  const stored = useBotLayout((s) => s.books[bookKey]);
  const tabs = useMemo(() => reconcileSideTabs(stored, sideTabFromRoute(workItemId, output)), [stored, workItemId, output]);
  const active = tabs.tabs.find((t) => t.key === tabs.active) ?? null;
  const fixedOpen = useBotLayout((s) => (channel ? fixedTabs(s.fixed, bookKey) : NO_FIXED));
  const side = useBotLayout((s) => s.side);
  const mainWidth = useBotLayout((s) => s.mainWidth);
  const wideHidden = useBotLayout((s) => s.wideHidden);
  const narrowShown = useBotLayout((s) => s.narrowShown);
  const fullStored = useBotLayout((s) => !!s.full[bookKey]);

  const sideKind = fixedOpen.includes(side) ? side : (fixedOpen[0] ?? null);
  const narrow = mainWidth > 0 && mainWidth < BOT_NARROW;
  const panelShown = narrow ? narrowShown : !wideHidden;
  const hasSide = inbox || (!!channel && view !== 'memory');
  const single = narrow && hasSide;
  const shown = inbox ? !!workItemId : hasSide && (!!workItemId || (panelShown && !!sideKind));
  const full = !narrow && fullStored;

  const layout = useBotLayout.getState;
  // 页签回到路由：任务只带 workItemId，产物再带 output；null（固定页签）两个都清掉。
  const at = (next: BotSideTab | null) => ({
    tab: 'bot' as const,
    channelId: routeChannelId,
    workItemId: next?.workItemId ?? null,
    view: inbox ? ('inbox' as const) : ('channel' as const),
    ...(next?.kind === 'output' ? { output: next.output } : {}),
  });
  const setShown = (on: boolean) => (narrow ? layout().setNarrowShown(on) : layout().setWideHidden(!on));
  const hide = () => {
    setShown(false);
    layout().setFull(bookKey, false);
    if (workItemId) useShell.getState().replace(at(null));
  };
  const selectTab = (tab: BotSideTab) => useShell.getState().go(at(tab));

  return {
    bookKey,
    inbox,
    channel,
    tabs,
    stored,
    active,
    fixedOpen,
    sideKind,
    narrow,
    single,
    shown,
    full,
    mode: sideMode(active, sideKind ?? 'tasks'),
    waiting: summary?.counts.needsYou ?? 0,
    suggestions: summary?.counts.suggested ?? 0,
    selectFixed: (kind) => {
      layout().setFixed(bookKey, openFixedTab(fixedOpen, kind));
      layout().setSide(kind);
      setShown(true);
      if (workItemId) useShell.getState().go(at(null));
    },
    hide,
    selectTab,
    // 关掉当前页签换到旁边那个；一个不剩又没有固定页签（收件箱、固定页签都关了）时收起右栏。
    closeTab: (tab) => {
      const next = closeSideTab(tabs, tab.key);
      layout().setBook(bookKey, next);
      if (tabs.active !== tab.key) return;
      const to = next.tabs.find((t) => t.key === next.active) ?? null;
      if (!to && !sideKind) hide();
      else useShell.getState().replace(at(to));
    },
    closeFixed: (kind) => {
      const showing = shown && !active && sideKind === kind;
      const next = afterFixedClose(fixedOpen, kind, tabs.tabs);
      layout().setFixed(
        bookKey,
        fixedOpen.filter((k) => k !== kind),
      );
      if (!showing) return;
      if (!next) hide();
      else if (next.startsWith('fixed:')) layout().setSide(next.slice('fixed:'.length) as FixedSideTab);
      else {
        const tab = tabs.tabs.find((t) => t.key === next);
        if (tab) selectTab(tab);
      }
    },
    toggleFull: () => layout().setFull(bookKey, !full),
  };
}

/** 收件箱或打开的频道有没有放进标题栏的标题（TitleBar 据此不放中间的「BaoCut」与帮助）；不在 Bot 页传 null。 */
export function useBotHasHead(route: Pick<BotRouteView, 'channelId' | 'view'> | null): boolean {
  const summary = useChannelSummary(!route || route.view === 'inbox' ? null : (route.channelId ?? MAIN_CHANNEL_ID));
  return !!route && (route.view === 'inbox' || !!summary);
}
