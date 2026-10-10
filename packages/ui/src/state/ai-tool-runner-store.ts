import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * AI 工具页「用」一行按工具记住的选择（原型 tool-setup.jsx `useRunner` 的 `runnerBy[tool]`）：交给 Agent 还是直接调模型，
 * 直接调模型时用哪只文本模型（`providerId/modelId`）。只是界面的偏好，跨会话记在本机（Web 也能用），不进 Runtime 的设置。
 * 交给 Agent 时用哪家 · 哪个模型不在这里：那是新会话的默认（与输入框底栏的 chip 同一份）。
 */
export type AiToolRunner = 'agent' | 'model';

export interface AiToolRunnerStore {
  runners: Record<string, AiToolRunner>;
  models: Record<string, string>;
  setRunner(tool: string, runner: AiToolRunner): void;
  setModel(tool: string, key: string): void;
}

export const useAiToolRunner = create<AiToolRunnerStore>()(
  persist(
    (set) => ({
      runners: {},
      models: {},
      setRunner: (tool, runner) => set((s) => ({ runners: { ...s.runners, [tool]: runner } })),
      setModel: (tool, key) => set((s) => ({ models: { ...s.models, [tool]: key } })),
    }),
    {
      name: 'baocut.ai-tool-runner',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ runners, models }) => ({ runners, models }),
    },
  ),
);
