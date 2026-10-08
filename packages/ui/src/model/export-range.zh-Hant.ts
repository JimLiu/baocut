import type { ExportRangeMessages } from './export-range.ts';

export const zhHant: ExportRangeMessages = {
  modeAll: '整部影片',
  modeChapters: '依章節',
  modeClips: '依片段',
  modeCustom: '自訂',
  chapterN: (n: number) => `第 ${n} 章`,
  clipN: (n: number) => `片段 ${n}`,
  whole: (clock: string) => `整部影片 ${clock}`,
  joined: (n: number, chapters: boolean, clock: string) => `${n} ${chapters ? '個章節' : '段'}合併為一段 · ${clock}`,
  separate: (n: number, clock: string) => `${n} 段 · 共 ${clock}`,
};
