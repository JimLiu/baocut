import type { ExportRangeMessages } from './export-range.ts';

export const zhHans: ExportRangeMessages = {
  modeAll: '整片',
  modeChapters: '按章节',
  modeClips: '按片段',
  modeCustom: '自定义',
  chapterN: (n: number) => `第 ${n} 章`,
  clipN: (n: number) => `片段 ${n}`,
  whole: (clock: string) => `整片 ${clock}`,
  joined: (n: number, chapters: boolean, clock: string) => `${n} ${chapters ? '章' : '段'}连成一段 · ${clock}`,
  separate: (n: number, clock: string) => `${n} 段 · 共 ${clock}`,
};
