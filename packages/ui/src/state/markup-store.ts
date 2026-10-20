import { create } from 'zustand';
import type { Id } from '@baocut/protocol';
import { init, sendable, type MarkupMode, type MarkupState } from '../model/markup.ts';
import { useEditor } from './editor-store.ts';

/**
 * 标注模式里的这一组标记（两种视图同一套；docs/design/lite-editor §4；画的过程见 model/markup.ts）。放在 store 里而不是标记层的组件里：
 * 切到时间线视图再切回来、标记层重新挂上时，没发出去的标记还在。按视频分：换了一部视频就从头来（颜色、粗细、工具也回到默认）。
 * 只在这个窗口里，不进视频、不进撤销；按「添加到对话」后标记换成视频标注草稿（draft-video-annotations-store），这里清空。
 * Web 的截图模式（`mode: 'screenshot'`）没有「添加到对话」：复制或下载图片后标记照旧留着，关闭时有标记就问一句。
 * `frames` 是画过标记的那几帧的截图（毫秒 → PNG）：标记画下去的那一刻从预览画布拷一份留着，「添加到对话」时只有当前帧在画布上，
 * 别的帧的图从这里取，画上那一帧的标记作为图片附件随消息交出；与标记一起清空。
 */
interface MarkupStore {
  videoId: Id | null;
  markup: MarkupState;
  frames: Record<number, Blob>;
  /** 记住某一帧的截图（已经有的不覆盖：先画的那一刻画布最接近用户看到的）。 */
  keepFrame(timeMs: number, png: Blob): void;
  /** 标记层挂到某部视频上：与上次不是同一部（或用法变了）就重来。 */
  bind(videoId: Id, mode?: MarkupMode): void;
  /** 改这一组标记（model/markup.ts 的纯函数）。 */
  apply(change: (s: MarkupState) => MarkupState): void;
  /** 清掉标记与历史，工具、颜色与粗细留着。 */
  reset(): void;
  /** 关闭标注模式：还有能发出去的标记时先问（`ask`），没有就清空、退出。 */
  close(): void;
  /** 确认放弃：清空、退出。 */
  discard(): void;
}

const keep = ({ mode, tool, shape, color, width }: MarkupState) => init({ mode, tool, shape, color, width });

export const useMarkup = create<MarkupStore>()((set, get) => ({
  videoId: null,
  markup: init(),
  frames: {},
  keepFrame: (timeMs, png) => set((s) => (s.frames[timeMs] ? {} : { frames: { ...s.frames, [timeMs]: png } })),
  bind: (videoId, mode = 'agent') => {
    if (get().videoId !== videoId || get().markup.mode !== mode) set({ videoId, markup: init({ mode }), frames: {} });
  },
  apply: (change) => set((s) => ({ markup: change(s.markup) })),
  reset: () => set((s) => ({ markup: keep(s.markup), frames: {} })),
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
