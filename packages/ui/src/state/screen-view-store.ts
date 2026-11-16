import { create } from 'zustand';
import type { Id } from '@baocut/protocol';

/**
 * 选中的那段缩放（屏幕录制设计 §5）：时间线的「缩放」行与检查器「屏幕取景」一节共用，舞台上的取景框也看它。
 * 不持久化；文档里没有这一段了就当没选中。
 */
export interface ScreenViewSelection {
  documentId: Id;
  zoomId: Id;
}

interface ScreenViewStore {
  selected: ScreenViewSelection | null;
  select(selected: ScreenViewSelection | null): void;
}

export const useScreenViewSelection = create<ScreenViewStore>()((set) => ({
  selected: null,
  select: (selected) => set({ selected }),
}));
