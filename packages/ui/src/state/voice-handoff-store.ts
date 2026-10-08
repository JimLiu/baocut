import { create } from 'zustand';
import type { Route } from './shell-store.ts';

/**
 * 去「我的声音」克隆一只新音色、存好再带回来（设计稿 store 的 `voiceHandoff`）：试听面板点「克隆新音色…」时记下从哪儿来、
 * 回哪儿去；我的声音存好后补上 `voiceId`，回到原处的那一块认领它（选上这只音色）后清掉。
 *
 * 另一个方向是「我的声音」的「试听克隆」：记下要在本地模型页展开哪一行的试听、选上哪只音色，那一行认领后清掉。
 * 都只在这次运行里有效，不落盘。
 */
export interface VoiceHandoff {
  /** 谁在等：`quick:<bundleId>` 是本地模型页那一行的试听。 */
  key: string;
  /** 回程条上的「从哪儿过来」：试听那一行的模型名（「Qwen3-TTS 0.6B Base」），句子由回程条的文案拼。 */
  from: string;
  route: Route;
  /** 存好的音色；还没存时没有。 */
  voiceId?: string;
}

export interface VoiceAuditionFocus {
  bundleId: string;
  /** 试听面板的音色键（`my:<id>`）。 */
  voice: string;
}

export interface VoiceHandoffStore {
  handoff: VoiceHandoff | null;
  focus: VoiceAuditionFocus | null;
  setHandoff(handoff: VoiceHandoff | null): void;
  /** 我的声音存好了一只：有人在等时记下它。 */
  saved(voiceId: string): void;
  setFocus(focus: VoiceAuditionFocus | null): void;
}

export const useVoiceHandoff = create<VoiceHandoffStore>()((set) => ({
  handoff: null,
  focus: null,
  setHandoff: (handoff) => set({ handoff }),
  saved: (voiceId) => set((s) => (s.handoff ? { handoff: { ...s.handoff, voiceId } } : {})),
  setFocus: (focus) => set({ focus }),
}));
