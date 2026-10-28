import type { TextEffort } from '@baocut/protocol';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { TextPick } from '../model/text-model-choice.ts';

/**
 * AI 工具页「用」一行按工具记住的选择（原型 tool-setup.jsx `useRunner` 的 `runnerBy[tool]`）：交给 Agent 还是直接调模型，
 * 直接调模型时用哪只文本模型（`providerId/modelId`），智能体再加推理强度（没选过的不记）。只是界面的偏好，跨会话记在本机（Web 也能用），不进 Runtime 的设置。
 * 交给 Agent 时用哪家 · 哪个模型不在这里：那是新会话的默认（与输入框底栏的 chip 同一份）。
 */
export type AiToolRunner = 'agent' | 'model';

export interface AiToolRunnerStore {
  runners: Record<string, AiToolRunner>;
  models: Record<string, string>;
  efforts: Record<string, TextEffort>;
  setRunner(tool: string, runner: AiToolRunner): void;
  setModel(tool: string, pick: TextPick): void;
}

export const useAiToolRunner = create<AiToolRunnerStore>()(
  persist(
    (set) => ({
      runners: {},
      models: {},
      efforts: {},
      setRunner: (tool, runner) => set((s) => ({ runners: { ...s.runners, [tool]: runner } })),
      setModel: (tool, pick) =>
        set((s) => {
          const efforts = { ...s.efforts };
          if (pick.effort) efforts[tool] = pick.effort;
          else delete efforts[tool];
          return { models: { ...s.models, [tool]: pick.key }, efforts };
        }),
    }),
    {
      name: 'baocut.ai-tool-runner',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ runners, models, efforts }) => ({ runners, models, efforts }),
    },
  ),
);
