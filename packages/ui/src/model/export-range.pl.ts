import { pluralForm } from '@baocut/protocol';
import type { ExportRangeMessages } from './export-range.ts';

export const pl: ExportRangeMessages = {
  modeAll: "Całe wideo",
  modeChapters: "Według rozdziału",
  modeClips: "Według klipu",
  modeCustom: "Niestandardowe",
  chapterN: (n: number) => `Rozdział ${n}`,
  clipN: (n: number) => `Klip ${n}`,
  whole: (clock: string) => `Całe wideo ${clock}`,
  joined: (n: number, chapters: boolean, clock: string) => `${chapters ? pluralForm('pl', n, { one: `${n} rozdział połączony`, few: `${n} rozdziały połączone`, many: `${n} rozdziałów połączonych`, other: `${n} rozdziału połączonego` }) : pluralForm('pl', n, { one: `${n} segment połączony`, few: `${n} segmenty połączone`, many: `${n} segmentów połączonych`, other: `${n} segmentu połączonego` })} w jeden · ${clock}`,
  separate: (n: number, clock: string) => `${pluralForm('pl', n, { one: `${n} segment`, few: `${n} segmenty`, many: `${n} segmentów`, other: `${n} segmentu` })} · ${clock} łącznie`,
};
