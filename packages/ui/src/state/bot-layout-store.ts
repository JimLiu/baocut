import { create } from 'zustand';
import type { Id } from '@baocut/protocol';
import { EMPTY_SIDE_TABS, FIXED_SIDE_TABS, type FixedSideTab, type SideTabs } from '../model/bot-side.ts';

/**
 * Bot 页右栏的界面状态（原型 page-bot.jsx 的 tabBook / fixedBook / fullBook / sideWidths 与 BotPage 的开合）：
 * 页签簿、开着的固定页签与占满按频道（收件箱一份）各记一份，离开 Bot 页再回来还在；拖过的宽按形态各记各的。
 * 标题栏（BotTitleBar）与 Bot 页（BotPage）读同一份，所以不放在组件里。只在内存里，重开应用回到默认。
 */
interface BotLayoutStore {
  books: Record<string, SideTabs>;
  /** 每份页签簿开着哪几个固定页签；没记过就两个都开着。 */
  fixed: Record<string, FixedSideTab[]>;
  full: Record<string, boolean>;
  /** 右栏 tasks / make / detail，占满时的左栏 full:tasks / full:make / full:inbox。 */
  widths: Record<string, number>;
  /** 没有任务页签选着时显示的固定页签：上次选的那个。 */
  side: FixedSideTab;
  /** 宽时记「收起了」，窄时记「打开了」：两边的默认不同，切宽窄时按 Home 的规矩带过去（BotPage）。 */
  wideHidden: boolean;
  narrowShown: boolean;
  /** 主区的宽（BotPage 量）；0 是还没量到。 */
  mainWidth: number;
  /** 开着设置对话框的频道：频道头的齿轮在标题栏里（BotChannelHead），对话框由 BotPage 画。 */
  settingsFor: Id | null;
  setBook(key: string, tabs: SideTabs): void;
  setFixed(key: string, open: FixedSideTab[]): void;
  setFull(key: string, on: boolean): void;
  setWidth(key: string, width: number | null): void;
  setSide(side: FixedSideTab): void;
  setWideHidden(hidden: boolean): void;
  setNarrowShown(shown: boolean): void;
  setMainWidth(width: number): void;
  setSettingsFor(channelId: Id | null): void;
}

export const useBotLayout = create<BotLayoutStore>()((set) => ({
  books: {},
  fixed: {},
  full: {},
  widths: {},
  side: 'tasks',
  wideHidden: false,
  narrowShown: false,
  mainWidth: 0,
  settingsFor: null,
  setBook: (key, tabs) => set((s) => (s.books[key] === tabs ? s : { books: { ...s.books, [key]: tabs } })),
  setFixed: (key, open) => set((s) => ({ fixed: { ...s.fixed, [key]: open } })),
  setFull: (key, on) => set((s) => (!!s.full[key] === on ? s : { full: { ...s.full, [key]: on } })),
  setWidth: (key, width) =>
    set((s) => {
      const widths = { ...s.widths };
      if (width === null) delete widths[key];
      else widths[key] = width;
      return { widths };
    }),
  setSide: (side) => set({ side }),
  setWideHidden: (wideHidden) => set({ wideHidden }),
  setNarrowShown: (narrowShown) => set({ narrowShown }),
  setMainWidth: (mainWidth) => set((s) => (s.mainWidth === mainWidth ? s : { mainWidth })),
  setSettingsFor: (settingsFor) => set({ settingsFor }),
}));

export const bookTabs = (books: Record<string, SideTabs>, key: string): SideTabs => books[key] ?? EMPTY_SIDE_TABS;
export const fixedTabs = (fixed: Record<string, FixedSideTab[]>, key: string): readonly FixedSideTab[] => fixed[key] ?? FIXED_SIDE_TABS;
