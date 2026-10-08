import type { ExportRangeMessages } from './export-range.ts';

export const tr: ExportRangeMessages = {
modeAll: 'Tüm video', modeChapters: 'Bölüme göre', modeClips: 'Klipe göre', modeCustom: 'Özel', chapterN: (n) => `Bölüm ${n}`, clipN: (n) => `Klip ${n}`, whole: (clock) => `Tüm video ${clock}`, joined: (n, chapters, clock) => `${n} ${chapters ? 'bölüm' : 'parça'} tek dosyada birleştirildi · ${clock}`, separate: (n, clock) => `${n} parça · toplam ${clock}`,
};
