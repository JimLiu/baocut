import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { parseOnboardingRecord, type OnboardingRecord } from '../model/onboarding.ts';

/**
 * 首次启动引导的记录（model/onboarding.ts）：走完或退出时记下，以后启动不再弹。界面偏好，记在这台电脑的本地存储里
 * （架构设计 §5.10：界面自己的记忆不进 Runtime 设置）；从没有引导的旧版升级上来时没有这条，于是也弹一次。
 */
interface OnboardingStore {
  record: OnboardingRecord | null;
  finish(record: OnboardingRecord): void;
}

export const useOnboarding = create<OnboardingStore>()(
  persist(
    (set) => ({
      record: null,
      finish: (record) => set({ record }),
    }),
    {
      name: 'baocut.onboarding',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ record: s.record }),
      merge: (persisted, current) => ({ ...current, record: parseOnboardingRecord((persisted as { record?: unknown } | null)?.record) }),
    },
  ),
);
