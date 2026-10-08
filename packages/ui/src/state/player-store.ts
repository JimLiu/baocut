import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/**
 * 播放器的视图状态（产品设计 §3.3：关掉功能区再打开，播放位置还在）。只属于这个窗口，不写进任何文件。
 * 播放位置与选的字幕按文件（`targetKey`）记在内存里；音量、静音、倍速、是否叠加字幕跨文件沿用，存在本机。
 */
export interface PlayerStore {
  positions: Record<string, number>;
  /** 每个文件选的字幕文件名；null 是「不用字幕」，没有记录时自动选同名的。 */
  tracks: Record<string, string | null>;
  volume: number;
  muted: boolean;
  rate: number;
  captions: boolean;
  remember(key: string, time: number): void;
  chooseTrack(key: string, fileName: string | null): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  setRate(rate: number): void;
  setCaptions(captions: boolean): void;
}

export const usePlayer = create<PlayerStore>()(
  persist(
    (set) => ({
      positions: {},
      tracks: {},
      volume: 1,
      muted: false,
      rate: 1,
      captions: true,
      remember: (key, time) => set((s) => ({ positions: { ...s.positions, [key]: time } })),
      chooseTrack: (key, fileName) => set((s) => ({ tracks: { ...s.tracks, [key]: fileName } })),
      setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)), muted: false }),
      setMuted: (muted) => set({ muted }),
      setRate: (rate) => set({ rate }),
      setCaptions: (captions) => set({ captions }),
    }),
    {
      name: 'baocut.player',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ volume: s.volume, muted: s.muted, rate: s.rate, captions: s.captions }),
    },
  ),
);
