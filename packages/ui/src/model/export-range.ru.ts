import { pluralForm } from '@baocut/protocol';
import type { ExportRangeMessages } from './export-range.ts';

export const ru: ExportRangeMessages = {
  modeAll: "Всё видео",
  modeChapters: "По главам",
  modeClips: "По клипам",
  modeCustom: "Пользовательский",
  chapterN: (n: number) => `Глава ${n}`,
  clipN: (n: number) => `Клип ${n}`,
  whole: (clock: string) => `Всё видео ${clock}`,
  joined: (n: number, chapters: boolean, clock: string) => `${chapters ? pluralForm('ru', n, { one: `${n} глава объединена`, few: `${n} главы объединены`, many: `${n} глав объединены`, other: `${n} главы объединено` }) : pluralForm('ru', n, { one: `${n} сегмент объединён`, few: `${n} сегмента объединены`, many: `${n} сегментов объединены`, other: `${n} сегмента объединено` })} в одно · ${clock}`,
  separate: (n: number, clock: string) => `${pluralForm('ru', n, { one: `${n} сегмент`, few: `${n} сегмента`, many: `${n} сегментов`, other: `${n} сегмента` })} · ${clock} всего`,
};
