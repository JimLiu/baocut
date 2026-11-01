import { create } from 'zustand';
import type { FileTarget, Id } from '@baocut/protocol';
import { targetKey } from '../model/workspace.ts';
import { EMPTY_SIDE_TABS, FIXED_SIDE_TABS, type FixedSideTab, type SideTabs } from '../model/bot-side.ts';

/**
 * 频道菜单打开的对话框（原型 page-bot-dialogs.jsx `openBotDialog`）：频道头、侧栏（钉住的与浮出的）都从这里开，
 * App 层的 BotDialogs 统一画，同一时间只有一个。
 */
export type BotDialog =
  | { kind: 'settings' | 'schedule' | 'rename' | 'instructions' | 'icon' | 'archive' | 'delete'; channelId: Id }
  /** 带 groupId 时建在那个分组里。 */
  | { kind: 'newChannel'; groupId?: Id }
  /** 带 moveChannelId 时建好把那个频道移进去（频道菜单「移到分组 › 新建分组…」）。 */
  | { kind: 'newGroup'; moveChannelId?: Id }
  | { kind: 'renameGroup'; groupId: Id };

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
  /** 右栏 tasks / make / detail / output，占满时的左栏 full:tasks / full:make / full:inbox / full:task。 */
  widths: Record<string, number>;
  /**
   * 视频产物页签打开的视频（按页签键，产物页认出来后记下）：AppShell 按它打开编辑器的视频；页签还开着时，
   * 切到别的页签也不关这部视频（同 Home 功能区的视频标签），回来时选区、播放头与撤销栈都在。
   */
  videos: Record<string, FileTarget>;
  /** 没有任务页签选着时显示的固定页签：上次选的那个。 */
  side: FixedSideTab;
  /** 宽时记「收起了」，窄时记「打开了」：两边的默认不同，切宽窄时按 Home 的规矩带过去（BotPage）。 */
  wideHidden: boolean;
  narrowShown: boolean;
  /** 主区的宽（BotPage 量）；0 是还没量到。 */
  mainWidth: number;
  dialog: BotDialog | null;
  setBook(key: string, tabs: SideTabs): void;
  setFixed(key: string, open: FixedSideTab[]): void;
  setFull(key: string, on: boolean): void;
  setWidth(key: string, width: number | null): void;
  setVideo(key: string, target: FileTarget): void;
  setSide(side: FixedSideTab): void;
  setWideHidden(hidden: boolean): void;
  setNarrowShown(shown: boolean): void;
  setMainWidth(width: number): void;
  setDialog(dialog: BotDialog | null): void;
}

export const useBotLayout = create<BotLayoutStore>()((set) => ({
  books: {},
  fixed: {},
  full: {},
  widths: {},
  videos: {},
  side: 'tasks',
  wideHidden: false,
  narrowShown: false,
  mainWidth: 0,
  dialog: null,
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
  setVideo: (key, target) =>
    set((s) => (s.videos[key] && targetKey(s.videos[key]) === targetKey(target) ? s : { videos: { ...s.videos, [key]: target } })),
  setSide: (side) => set({ side }),
  setWideHidden: (wideHidden) => set({ wideHidden }),
  setNarrowShown: (narrowShown) => set({ narrowShown }),
  setMainWidth: (mainWidth) => set((s) => (s.mainWidth === mainWidth ? s : { mainWidth })),
  setDialog: (dialog) => set({ dialog }),
}));

export const bookTabs = (books: Record<string, SideTabs>, key: string): SideTabs => books[key] ?? EMPTY_SIDE_TABS;
export const fixedTabs = (fixed: Record<string, FixedSideTab[]>, key: string): readonly FixedSideTab[] => fixed[key] ?? FIXED_SIDE_TABS;

/** 哪份页签簿里还开着打开这部视频（`targetKey`）的产物页签。 */
export function isBotVideoReferenced(state: Pick<BotLayoutStore, 'books' | 'videos'>, key: string): boolean {
  return Object.values(state.books).some((book) =>
    book.tabs.some((tab) => tab.kind === 'output' && !!state.videos[tab.key] && targetKey(state.videos[tab.key]!) === key),
  );
}
