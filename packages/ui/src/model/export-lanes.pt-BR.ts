import type { ExportLanesMessages } from './export-lanes.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: ExportLanesMessages = {
  hidden: 'Oculto na linha do tempo',
  otherSolo: 'Outra faixa está em solo',
  muted: 'Silenciado na linha do tempo',
  otherSoloAudio: 'Outra faixa está em solo',
  subtitles: 'Legendas',
  names: (names: readonly string[]) => names.join(', '),
  sound: (reason: string) => `Som: ${reason}`,
  clips: (n: number) => pluralForm('pt-BR', n, { one: `${n} clipe`, other: `${n} clipes` }),
  sounds: (n: number) => pluralForm('pt-BR', n, { one: `${n} clipe de áudio`, other: `${n} clipes de áudio` }),
};
