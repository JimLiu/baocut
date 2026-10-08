import type { ExportRangeMessages } from './export-range.ts';

export const ja: ExportRangeMessages = {
  modeAll: '動画全体',
  modeChapters: 'チャプターごと',
  modeClips: 'クリップごと',
  modeCustom: 'カスタム',
  chapterN: (n: number) => `チャプター ${n}`,
  clipN: (n: number) => `クリップ ${n}`,
  whole: (clock: string) => `動画全体 ${clock}`,
  joined: (n: number, chapters: boolean, clock: string) => `${n} ${chapters ? 'チャプター' : '区間'}を 1 本につなげる · ${clock}`,
  separate: (n: number, clock: string) => `${n} 区間 · 合計 ${clock}`,
};
