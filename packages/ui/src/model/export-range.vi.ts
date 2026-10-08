import type { ExportRangeMessages } from './export-range.ts';

export const vi: ExportRangeMessages = {
modeAll: 'Toàn bộ video', modeChapters: 'Theo chương', modeClips: 'Theo clip', modeCustom: 'Tùy chỉnh', chapterN: (n) => `Chương ${n}`, clipN: (n) => `Clip ${n}`, whole: (clock) => `Toàn bộ video ${clock}`, joined: (n, chapters, clock) => `${n} ${chapters ? 'chương' : 'đoạn'} ghép thành một · ${clock}`, separate: (n, clock) => `${n} đoạn · tổng ${clock}`,
};
