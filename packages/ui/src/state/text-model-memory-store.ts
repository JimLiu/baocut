import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * 文本模型按位置记住的上一次选择（产品设计 §7.6：每个选模型的地方记住上次选的）：`providerId/modelId`。
 * 只是界面的偏好，跨会话记在本机，不改设置里的默认模型。文本工具的选择记在 tools-store 的草稿里，
 * 编辑器 AI 工具「直接调模型」的记在 ai-tool-runner-store，这里管其余几处。
 *
 * - `translate-tool`：工具页「翻译」。
 * - `dub-tool`：工具页「配音」先翻译时的文本模型。
 * - `editor-translate`：编辑器的翻译流程；重新翻译（`useRetranslateModel`）也用它。
 * - `editor-dub`：编辑器配音流程先翻译时的文本模型。
 */
export type TextModelPlace = 'translate-tool' | 'dub-tool' | 'editor-translate' | 'editor-dub';

const PLACES: readonly TextModelPlace[] = ['translate-tool', 'dub-tool', 'editor-translate', 'editor-dub'];

/** 读出来的记忆只认已知的位置与非空字符串，别的一律当没有。 */
export function textModelsOf(persisted: unknown): Partial<Record<TextModelPlace, string>> {
  const models = ((persisted ?? {}) as { models?: unknown }).models;
  const out: Partial<Record<TextModelPlace, string>> = {};
  if (!models || typeof models !== 'object') return out;
  for (const place of PLACES) {
    const key = (models as Record<string, unknown>)[place];
    if (typeof key === 'string' && key) out[place] = key;
  }
  return out;
}

export interface TextModelMemoryStore {
  models: Partial<Record<TextModelPlace, string>>;
  remember(place: TextModelPlace, key: string): void;
}

export const useTextModelMemory = create<TextModelMemoryStore>()(
  persist(
    (set) => ({
      models: {},
      remember: (place, key) => set((s) => ({ models: { ...s.models, [place]: key } })),
    }),
    {
      name: 'baocut.text-model-memory',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ models }) => ({ models }),
      merge: (persisted, current) => ({ ...current, models: textModelsOf(persisted) }),
    },
  ),
);

/** 一处记住的文本模型；没选过时 null（按默认模型与能用的挑）。 */
export function useRememberedTextModel(place: TextModelPlace): [string | null, (key: string) => void] {
  const saved = useTextModelMemory((s) => s.models[place] ?? null);
  const remember = useTextModelMemory((s) => s.remember);
  return [saved, (key) => remember(place, key)];
}
