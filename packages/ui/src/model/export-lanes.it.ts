import type { ExportLanesMessages } from './export-lanes.ts';
import { pluralForm } from '@baocut/protocol';

export const it: ExportLanesMessages = {
  hidden: 'Nascosto nella timeline',
  otherSolo: 'Un’altra traccia è in solo',
  muted: 'Audio disattivato nella timeline',
  otherSoloAudio: 'Un’altra traccia è in solo',
  subtitles: 'Sottotitoli',
  names: (names: readonly string[]) => names.join(', '),
  sound: (reason: string) => `Suono: ${reason}`,
  clips: (n: number) => `${n} clip`,
  sounds: (n: number) => `${n} clip audio`,
};
