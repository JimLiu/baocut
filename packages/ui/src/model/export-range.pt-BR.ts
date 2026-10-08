import type { ExportRangeMessages } from './export-range.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: ExportRangeMessages = {
  modeAll: 'Vídeo inteiro', modeChapters: 'Por capítulo', modeClips: 'Por clipe', modeCustom: 'Personalizado',
  chapterN: (n: number) => `Capítulo ${n}`,
  clipN: (n: number) => `Clipe ${n}`,
  whole: (clock: string) => `Vídeo inteiro ${clock}`,
  joined: (n: number, chapters: boolean, clock: string) => `${pluralForm('pt-BR', n, { one: `${n} ${chapters ? 'capítulo unido' : 'segmento unido'}`, other: `${n} ${chapters ? 'capítulos unidos' : 'segmentos unidos'}` })} em um só · ${clock}`,
  separate: (n: number, clock: string) => `${pluralForm('pt-BR', n, { one: `${n} segmento`, other: `${n} segmentos` })} · ${clock} no total`,
};
