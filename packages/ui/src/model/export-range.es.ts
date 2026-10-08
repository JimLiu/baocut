import type { ExportRangeMessages } from './export-range.ts';
import { pluralForm } from '@baocut/protocol';
export const es: ExportRangeMessages = {
 modeAll: "Todo el vídeo", modeChapters: 'Por capítulo', modeClips: 'Por clip', modeCustom: 'Personalizado',
 chapterN: (n) => `Capítulo ${n}`, clipN: (n) => `Clip ${n}`, whole: (clock) => `Vídeo completo ${clock}`,
 joined: (n, chapters, clock) => `${n} ${chapters ? pluralForm('es', n, { one: 'capítulo unido', other: 'capítulos unidos' }) : pluralForm('es', n, { one: 'segmento unido', other: 'segmentos unidos' })} en uno · ${clock}`,
 separate: (n, clock) => `${n} ${pluralForm('es', n, { one: 'segmento', other: 'segmentos' })} · ${clock} en total`,
};
