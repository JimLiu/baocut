import { pluralForm } from '@baocut/protocol';
import type { ExportLanesMessages } from './export-lanes.ts';

export const de: ExportLanesMessages = {
  hidden: "In Zeitleiste ausgeblendet",
  otherSolo: "Eine andere Spur ist solo geschaltet",
  muted: "In Zeitleiste stummgeschaltet",
  otherSoloAudio: "Eine andere Spur ist solo geschaltet",
  subtitles: "Untertitel",
  names: (names: readonly string[]) => names.join(", "),
  sound: (reason: string) => `Ton: ${reason}`,
  clips: (n: number) => (pluralForm('de', n, { one: "1 Clip", other: `${n} Clips` })),
  sounds: (n: number) => (pluralForm('de', n, { one: "1 Audioclip", other: `${n} Audioclips` })),
};
