import { create } from 'zustand';

/**
 * 帮助中心的开合（原型 shell.jsx:210-231）：只活在外壳里，标题栏问号、F1 与设置左栏的「帮助」都经这里打开。
 * 打开前的焦点记在 `origin`：S2 弹层关闭时自己会把焦点还回去，这里只在它没还成时兜底（见 help-center）。
 *
 * 原型打开时还会暂停编辑器的播放、收起编辑器的弹层。这里没做暂停：编辑器的 pause 只在 VideoEditor 的
 * EditorContext 里，外壳拿不到（editor-store 的 `playing` 只是显示用，改它不会停预览引擎）。帮助开着时
 * 编辑器的按键已被 `[role="dialog"]` 挡住，只是画面会继续播。编辑器的弹层都是对话框或菜单，开着时 F1 不响应、
 * 标题栏按钮也点不到，不用另收。
 */
export interface HelpStore {
  isOpen: boolean;
  /** 第几次打开：每次打开都从快速上手重新开始（原型关闭时整个卸掉），帮助中心按它换 key。 */
  session: number;
  origin: HTMLElement | null;
  open(origin?: Element | null): void;
  close(): void;
}

export const useHelp = create<HelpStore>()((set) => ({
  isOpen: false,
  session: 0,
  origin: null,
  open: (origin) => {
    const from = origin ?? (typeof document !== 'undefined' ? document.activeElement : null);
    set((s) => ({
      isOpen: true,
      session: s.isOpen ? s.session : s.session + 1,
      origin: typeof HTMLElement !== 'undefined' && from instanceof HTMLElement ? from : null,
    }));
  },
  close: () => set({ isOpen: false }),
}));
