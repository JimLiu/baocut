import type { ExportLanesMessages } from './export-lanes.ts';

export const zhHans: ExportLanesMessages = {
  hidden: '时间轴上隐藏',
  otherSolo: '别的轨在独显',
  muted: '时间轴上静音',
  otherSoloAudio: '别的轨在独听',
  subtitles: '字幕',
  names: (names: readonly string[]) => names.join('、'),
  sound: (reason: string) => `声音：${reason}`,
  clips: (n: number) => `${n} 个片段`,
  sounds: (n: number) => `${n} 段声音`,
};
