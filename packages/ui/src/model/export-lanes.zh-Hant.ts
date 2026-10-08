import type { ExportLanesMessages } from './export-lanes.ts';

export const zhHant: ExportLanesMessages = {
  hidden: '已在時間軸上隱藏',
  otherSolo: '其他軌道正在獨顯',
  muted: '已在時間軸上靜音',
  otherSoloAudio: '其他軌道正在獨奏',
  subtitles: '字幕',
  names: (names: readonly string[]) => names.join('、'),
  sound: (reason: string) => `聲音：${reason}`,
  clips: (n: number) => `${n} 段片段`,
  sounds: (n: number) => `${n} 段音訊片段`,
};
