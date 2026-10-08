import { create } from 'zustand';
import { applySettingsEvent } from '@baocut/client';
import type { SettingValues, SettingsEvent, SettingsSnapshot } from '@baocut/protocol';

/** 偏好设置的镜像（`settings` 主题）：全部键的有效值与默认值；没连上之前是 null。 */
export interface SettingsStore {
  snapshot: SettingsSnapshot | null;
  replace(snapshot: SettingsSnapshot): void;
  apply(event: SettingsEvent): void;
}

export const useSettings = create<SettingsStore>()((set) => ({
  snapshot: null,
  replace: (snapshot) => set({ snapshot }),
  apply: (event) => set((s) => (s.snapshot ? { snapshot: applySettingsEvent(s.snapshot, event) } : s)),
}));

/** 一个键的有效值；快照没到时 null。 */
export function useSetting<K extends keyof SettingValues>(key: K): SettingValues[K] | null {
  return useSettings((s) => s.snapshot?.settings[key] ?? null);
}
