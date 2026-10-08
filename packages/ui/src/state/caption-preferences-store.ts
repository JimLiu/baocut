import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { asObject, type Json, type LineKind } from '../render/text-style.ts';
import { cleanCaptionPreferences, preferredCaptionStyle, rememberCaptionPreferences } from '../model/caption-preferences.ts';

/** 客户端自己的新字幕选项；实际视频样式仍由视频内的 caption-style 文档保存。 */
export const useCaptionPreferences = create<{ preferences: Json; remember(before: Json, after: Json, singleLine?: LineKind): void }>()(
  persist((set) => ({
    preferences: {},
    remember: (before, after, singleLine) => set((s) => ({ preferences: rememberCaptionPreferences(s.preferences, before, after, singleLine) })),
  }), {
    name: 'baocut.captionPreferences',
    version: 1,
    storage: createJSONStorage(() => localStorage),
    partialize: (s) => ({ preferences: s.preferences }),
    merge: (saved, current) => ({ ...current, preferences: cleanCaptionPreferences(asObject(saved).preferences) }),
  }),
);

export const newCaptionStyle = (): Json => preferredCaptionStyle(useCaptionPreferences.getState().preferences);
