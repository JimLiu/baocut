import { pluralForm } from '@baocut/protocol';
import type { TaskFactsMessages } from './task-facts.ts';

export const de: TaskFactsMessages = {
  fact: {
    kind: "Typ",
    submitter: "Gestartet von",
    status: "Status",
    startedAt: "Gestartet",
    runsOn: "Ausgeführt auf",
    language: "Sprache",
    phase: "Phase",
    images: "Bilder",
    took: "Dauer",
    cost: "Kosten",
  },
  imageCount: (count: number) => `${count} ${pluralForm('de', count, { one: "Bild", other: "Bilder" })}`,
};
