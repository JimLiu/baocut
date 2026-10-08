import type { ExportRangeMessages } from './export-range.ts';

export const ko: ExportRangeMessages = {
  modeAll: '영상 전체',
  modeChapters: '챕터별',
  modeClips: '클립별',
  modeCustom: '사용자 지정',
  chapterN: (n: number) => `챕터 ${n}`,
  clipN: (n: number) => `클립 ${n}`,
  whole: (clock: string) => `영상 전체 ${clock}`,
  joined: (n: number, chapters: boolean, clock: string) => `${chapters ? '챕터' : '구간'} ${n}개를 하나로 연결 · ${clock}`,
  separate: (n: number, clock: string) => `구간 ${n}개 · 총 ${clock}`,
};
