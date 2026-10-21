import { create } from 'zustand';
import type { Id } from '@baocut/protocol';
import { forget, init, markupTools, marksOnFrame, sendable, type MarkupMode, type MarkupState } from '../model/markup.ts';
import { useEditor } from './editor-store.ts';

/**
 * 标注模式里的这一组标记（两种视图同一套；docs/design/lite-editor §4；画的过程见 model/markup.ts）。放在 store 里而不是标记层的组件里：
 * 切到时间线视图再切回来、标记层重新挂上时，没发出去的标记还在。按视频分：换了一部视频标记就从头来；工具、形状、颜色、粗细与文字的样子这个会话里一直记着（lite-editor §4.1「记住上一次」）。
 * 只在这个窗口里，不进视频、不进撤销；按「添加到对话」后标记换成视频标注草稿（draft-video-annotations-store），这里清空。
 * Web 的截图模式（`mode: 'screenshot'`）没有「添加到对话」：复制或下载出一帧的图后，这一帧的标记与截图清掉（`forgetFrame`），
 * 别的帧上的留着；关闭时有标记就问一句。
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
  /** 出过图的这一帧（`nowMs` ±near）：它上面的标记从画面与历史里拿掉（撤销不再带回来），没有标记了的帧的截图一起丢。 */
  forgetFrame(nowMs: number): void;
  /** 清掉标记与历史，工具、形状、颜色、粗细与文字的样子留着。 */
  reset(): void;
  /** 关闭标注模式：还有能发出去的标记时先问（`ask`），没有就清空、退出。 */
  close(): void;
  /** 确认放弃：清空、退出。 */
  discard(): void;
}

/** 留下工具条的选择、换掉标记；换了用法时这种用法下没有的工具（截图模式的评论）回到画笔。 */
const keep = ({ tool, shape, color, width, textStyle }: MarkupState, mode: MarkupMode) =>
  init({ mode, tool: markupTools(mode).includes(tool) ? tool : 'pen', shape, color, width, textStyle });

export const useMarkup = create<MarkupStore>()((set, get) => ({
  videoId: null,
  markup: init(),
  frames: {},
  keepFrame: (timeMs, png) => set((s) => (s.frames[timeMs] ? {} : { frames: { ...s.frames, [timeMs]: png } })),
  bind: (videoId, mode = 'agent') => {
    if (get().videoId !== videoId || get().markup.mode !== mode) set({ videoId, markup: keep(get().markup, mode), frames: {} });
  },
  apply: (change) => set((s) => ({ markup: change(s.markup) })),
  forgetFrame: (nowMs) =>
    set((s) => {
      const markup = forget(
        s.markup,
        marksOnFrame(s.markup.marks, nowMs).map((m) => m.id),
      );
      const left = new Set(markup.marks.map((m) => m.timeMs));
      const frames = Object.fromEntries(Object.entries(s.frames).filter(([timeMs]) => left.has(Number(timeMs))));
      return { markup, frames };
    }),
  reset: () => set((s) => ({ markup: keep(s.markup, s.markup.mode), frames: {} })),
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
