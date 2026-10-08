import type { ExportRangeMessages } from './export-range.ts';
import { pluralForm } from '@baocut/protocol';

export const it: ExportRangeMessages = {
  modeAll: 'Video intero', modeChapters: 'Per capitolo', modeClips: 'Per clip', modeCustom: 'Personalizzato',
  chapterN: (n: number) => `Capitolo ${n}`,
  clipN: (n: number) => `Clip ${n}`,
  whole: (clock: string) => `Video intero ${clock}`,
  joined: (n: number, chapters: boolean, clock: string) => `${pluralForm('it', n, { one: `${n} ${chapters ? 'capitolo unito' : 'segmento unito'}`, other: `${n} ${chapters ? 'capitoli uniti' : 'segmenti uniti'}` })} in uno · ${clock}`,
  separate: (n: number, clock: string) => `${pluralForm('it', n, { one: `${n} segmento`, other: `${n} segmenti` })} · ${clock} totali`,
};
