import { create } from 'zustand';
import type { Route } from './shell-store.ts';

/**
 * 去「我的声音」克隆一只新音色、存好再带回来（设计稿 store 的 `voiceHandoff`）：试听面板点「克隆新音色…」时记下从哪儿来、
 * 回哪儿去；我的声音存好后补上 `voiceId`，回到原处的那一块认领它（选上这只音色）后清掉。
 *
 * 模型页（本机能克隆的模型、能克隆的云端提供方）那一行的「克隆新音色」也走这里：带上 `target` 与 `open`，我的声音直接打开采集、
 * 预选那只模型。
 *
 * 音色选择器（共享的 VoicePicker、配音页）里选了一只还没在某家云端建好的：补那一步要去我的声音时也走这里（`pick:` 开头的 `key`）。
 * 补录授权声明带 `task`，到了我的声音直接打开补录、存好就上传，补上 `voiceId` 后回程条跟着那家的克隆走；看没建成的原因直接带
 * `voiceId`。选择器那一处已经选上了这只，回去后由它认领（清掉）。
 *
 * 另一个方向是「我的声音」的「试听克隆」：记下要在本地模型页展开哪一行的试听、选上哪只音色，那一行认领后清掉。
 * 都只在这次运行里有效，不落盘。
 */
export interface VoiceHandoff {
  /**
   * 谁在等：`quick:<bundleId>` 是本地模型页那一行的试听；`model:<id>` 是模型页那一行的「克隆新音色」（存好后只带回去，不认领）；
   * `pick:<哪一处>` 是音色选择器（回去后那一处认领）。
   */
  key: string;
  /** 回程条上的「从哪儿过来」：试听那一行的模型名（「Qwen3-TTS 0.6B Base」），句子由回程条的文案拼。 */
  from: string;
  route: Route;
  /** 从模型页过来：克隆新音色时预选这只模型（本机模型 ID 或云端的 `providerId`）。 */
  target?: { kind: 'local' | 'cloud'; id: string };
  /** 到了我的声音直接打开：`mic` 克隆新音色（先选模型，样本默认用麦克风）；`task` 打开 `task` 那一步。打开一次就摘掉。 */
  open?: 'mic' | 'task';
  /** 从音色选择器过来补的一步：给这只音色补录授权声明，存好后上传到 `target` 那家。 */
  task?: { kind: 'consent'; voiceId: string };
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
