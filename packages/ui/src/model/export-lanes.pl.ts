import { pluralForm } from '@baocut/protocol';
import type { ExportLanesMessages } from './export-lanes.ts';

export const pl: ExportLanesMessages = {
  hidden: "Ukryte na osi czasu",
  otherSolo: "Inna ścieżka ma włączone solo",
  muted: "Wyciszone na osi czasu",
  otherSoloAudio: "Inna ścieżka ma włączone solo",
  subtitles: "Napisy",
  names: (names: readonly string[]) => names.join(", "),
  sound: (reason: string) => `Dźwięk: ${reason}`,
  clips: (n: number) => pluralForm('pl', n, { one: `${n} klip`, few: `${n} klipy`, many: `${n} klipów`, other: `${n} klipu` }),
  sounds: (n: number) => pluralForm('pl', n, { one: `${n} klip audio`, few: `${n} klipy audio`, many: `${n} klipów audio`, other: `${n} klipu audio` }),
};
