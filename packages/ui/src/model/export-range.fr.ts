import type { ExportRangeMessages } from './export-range.ts';
import { pluralForm } from '@baocut/protocol';

export const fr: ExportRangeMessages = {
  modeAll: 'Vidéo entière', modeChapters: 'Par chapitre', modeClips: 'Par clip', modeCustom: 'Personnalisé', chapterN: (n) => `Chapitre ${n}`, clipN: (n) => `Clip ${n}`, whole: (clock) => `Vidéo entière ${clock}`, joined: (n, chapters, clock) => `${n} ${chapters ? pluralForm('fr', n, { one: 'chapitre réuni', other: 'chapitres réunis' }) : pluralForm('fr', n, { one: 'segment réuni', other: 'segments réunis' })} en un seul · ${clock}`, separate: (n, clock) => `${n} ${pluralForm('fr', n, { one: 'segment', other: 'segments' })} · ${clock} au total`,
};
