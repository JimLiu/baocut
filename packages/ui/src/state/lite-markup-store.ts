import { create } from 'zustand';
import type { Id } from '@baocut/protocol';
import { init, sendable, type MarkupState } from '../model/lite-markup.ts';
import { useEditor } from './editor-store.ts';

/**
 * 轻量视图标注模式里的这一组标记（docs/design/lite-editor §4；画的过程见 model/lite-markup.ts）。放在 store 里而不是标记层的组件里：
 * 切到时间线视图再切回来、标记层重新挂上时，没发出去的标记还在。按视频分：换了一部视频就从头来（颜色、粗细、工具也回到默认）。
 * 只在这个窗口里，不进视频、不进撤销；按「添加到对话」后标记换成视频标注草稿（draft-video-annotations-store），这里清空。
 */
interface LiteMarkupStore {
  videoId: Id | null;
  markup: MarkupState;
  /** 标记层挂到某部视频上：与上次不是同一部就重来。 */
  bind(videoId: Id): void;
  /** 改这一组标记（model/lite-markup.ts 的纯函数）。 */
  apply(change: (s: MarkupState) => MarkupState): void;
  /** 清掉标记与历史，工具、颜色与粗细留着。 */
  reset(): void;
  /** 关闭标注模式：还有能发出去的标记时先问（`ask`），没有就清空、退出。 */
  close(): void;
  /** 确认放弃：清空、退出。 */
  discard(): void;
}

const keep = ({ tool, shape, color, width }: MarkupState) => init({ tool, shape, color, width });

export const useLiteMarkup = create<LiteMarkupStore>()((set, get) => ({
  videoId: null,
  markup: init(),
  bind: (videoId) => {
    if (get().videoId !== videoId) set({ videoId, markup: init() });
  },
  apply: (change) => set((s) => ({ markup: change(s.markup) })),
  reset: () => set((s) => ({ markup: keep(s.markup) })),
  close: () => {
    const { markup } = get();
    if (sendable(markup.marks).length) {
      set({ markup: { ...markup, ask: true } });
      return;
    }
    get().discard();
  },
  discard: () => {
    get().reset();
    useEditor.getState().setAnnotating(false);
  },
}));
