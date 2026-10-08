const sentencesEn = (n: number) => pluralForm('de', n, { one: `${n} Satz`, other: `${n} Sätze` });
const filesEn = (n: number) => pluralForm('de', n, { one: `${n} Datei`, other: `${n} Dateien` });
type DubStatus = 'failed' | 'needs-fit' | 'stale' | 'draft';
import { pluralForm } from '@baocut/protocol';
import type { EditorOpsMessages } from './editor-ops.ts';

export const de: EditorOpsMessages = {
  dubStatus: {
    failed: "Nicht synthetisiert",
    'needs-fit': "Zu lang",
    stale: "Übersetzung veraltet",
    draft: "Nicht platziert",
  } as Record<DubStatus, string>,
  dubStatusCount: (n: number, status: DubStatus) =>
    `${sentencesEn(n)} ${{ failed: "nicht synthetisiert", 'needs-fit': "zu lang", stale: "mit veralteter Übersetzung", draft: "nicht platziert" }[status]}`,
  stemVocals: "Getrennte Stimmen",
  stemBackground: "Getrennter Hintergrund",
  background: "Hintergrund",
  sentenceN: (n: number) => `Satz ${n}`,
  dub: "Vertonung",
  files: filesEn,
  sentences: sentencesEn,
  muted: (n: number) => `${sentencesEn(n)} stummgeschaltet`,
  dubTitle: (language: string | null) => `Vertonung · ${language ?? "Unbekannte Sprache"}`,
  aside: (groups: number, files: number) =>
    groups ? `${pluralForm('de', groups, { one: "1 Vertonungsgruppe", other: `${groups} Vertonungsgruppen` })} · ${filesEn(files)}` : filesEn(files),
};
