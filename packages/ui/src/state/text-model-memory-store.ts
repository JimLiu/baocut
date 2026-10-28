import { TEXT_EFFORTS, type TextEffort } from '@baocut/protocol';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { TextPick } from '../model/text-model-choice.ts';

/**
 * 文本模型按位置记住的上一次选择（产品设计 §7.6：每个选模型的地方记住上次选的）：`providerId/modelId`，智能体再加推理强度
 * （没选过的不记，用模型自己的默认）。只是界面的偏好，跨会话记在本机，不改设置里的默认模型。文本工具的选择记在 tools-store 的草稿里，
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
  return placesOf(persisted, 'models', (v): v is string => typeof v === 'string' && v.length > 0);
}

/** 推理强度只认已知的位置与 `TextEffort` 的几档。 */
export function textEffortsOf(persisted: unknown): Partial<Record<TextModelPlace, TextEffort>> {
  return placesOf(persisted, 'efforts', (v): v is TextEffort => TEXT_EFFORTS.includes(v as TextEffort));
}

function placesOf<T>(persisted: unknown, field: 'models' | 'efforts', ok: (v: unknown) => v is T): Partial<Record<TextModelPlace, T>> {
  const map = ((persisted ?? {}) as Record<string, unknown>)[field];
  const out: Partial<Record<TextModelPlace, T>> = {};
  if (!map || typeof map !== 'object') return out;
  for (const place of PLACES) {
    const value = (map as Record<string, unknown>)[place];
    if (ok(value)) out[place] = value;
  }
  return out;
}

export interface TextModelMemoryStore {
  models: Partial<Record<TextModelPlace, string>>;
  efforts: Partial<Record<TextModelPlace, TextEffort>>;
  remember(place: TextModelPlace, pick: TextPick): void;
}

export const useTextModelMemory = create<TextModelMemoryStore>()(
  persist(
    (set) => ({
      models: {},
      efforts: {},
      remember: (place, pick) =>
        set((s) => {
          const efforts = { ...s.efforts };
          if (pick.effort) efforts[place] = pick.effort;
          else delete efforts[place];
          return { models: { ...s.models, [place]: pick.key }, efforts };
        }),
    }),
    {
      name: 'baocut.text-model-memory',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ models, efforts }) => ({ models, efforts }),
      merge: (persisted, current) => ({ ...current, models: textModelsOf(persisted), efforts: textEffortsOf(persisted) }),
    },
  ),
);

/** 一处记住的文本模型与推理强度；没选过时 null（模型按默认模型与能用的挑，推理强度用模型自己的默认）。 */
export function useRememberedTextModel(place: TextModelPlace): {
  key: string | null;
  effort: TextEffort | null;
  remember: (pick: TextPick) => void;
} {
  const key = useTextModelMemory((s) => s.models[place] ?? null);
  const effort = useTextModelMemory((s) => s.efforts[place] ?? null);
  const remember = useTextModelMemory((s) => s.remember);
  return { key, effort, remember: (pick) => remember(place, pick) };
}
