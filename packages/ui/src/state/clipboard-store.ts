import { create } from 'zustand';
import type { Id, SequenceItem } from '@baocut/protocol';

/**
 * 时间线的剪贴板（原型 editor-keys 的 clipRef / genRef）：应用内的，不碰系统剪贴板——复制的是片段，不是文本。
 * 不持久化；换视频后仍在，但只能粘回复制它的那个视频（素材与文档的 ID 只在那个视频里有效）。
 */
export interface ClipboardStore {
  /** 复制那一刻的片段快照，按轨道自下而上、时间先后排。 */
  entries: SequenceItem[];
  /** 从哪个视频复制的。 */
  videoId: Id | null;
  /** 本次会话粘贴（含再制）了几次：每次的副本在画面上多错开一档。 */
  generation: number;
  put(videoId: Id, entries: SequenceItem[]): void;
  /** 下一次粘贴是第几次。 */
  nextGeneration(): number;
}

export const useClipboard = create<ClipboardStore>()((set, get) => ({
  entries: [],
  videoId: null,
  generation: 0,
  put: (videoId, entries) => set({ videoId, entries }),
  nextGeneration: () => {
    const generation = get().generation + 1;
    set({ generation });
    return generation;
  },
}));
