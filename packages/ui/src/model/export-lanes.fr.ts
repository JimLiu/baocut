import type { ExportLanesMessages } from './export-lanes.ts';
import { pluralForm } from '@baocut/protocol';

export const fr: ExportLanesMessages = {
  hidden: 'Masqué sur la timeline', otherSolo: 'Une autre piste est en solo', muted: 'En sourdine sur la timeline', otherSoloAudio: 'Une autre piste est en solo', subtitles: 'Sous-titres', names: (names) => names.join(', '), sound: (reason) => `Son : ${reason}`, clips: (n) => `${n} ${pluralForm('fr', n, { one: 'clip', other: 'clips' })}`, sounds: (n) => `${n} ${pluralForm('fr', n, { one: 'clip audio', other: 'clips audio' })}`,
};
