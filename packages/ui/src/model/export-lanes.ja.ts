import type { ExportLanesMessages } from './export-lanes.ts';

export const ja: ExportLanesMessages = {
  hidden: 'タイムラインで非表示',
  otherSolo: '別のトラックをソロ表示中',
  muted: 'タイムラインでミュート',
  otherSoloAudio: '別のトラックをソロ再生中',
  subtitles: '字幕',
  names: (names: readonly string[]) => names.join('、'),
  sound: (reason: string) => `音声：${reason}`,
  clips: (n: number) => `クリップ ${n} 個`,
  sounds: (n: number) => `音声クリップ ${n} 個`,
};
