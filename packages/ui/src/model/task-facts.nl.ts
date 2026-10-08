import { pluralForm } from '@baocut/protocol';
import type { TaskFactsMessages } from './task-facts.ts';

export const nl: TaskFactsMessages = {
  fact: {
    kind: "Type",
    submitter: "Gestart door",
    status: "Status",
    startedAt: "Gestart",
    runsOn: "Wordt uitgevoerd op",
    language: "Taal",
    phase: "Fase",
    images: "Afbeeldingen",
    took: "Tijdsduur",
    cost: "Kosten",
  },
  imageCount: (count: number) => `${count} ${pluralForm('nl', count, { one: "afbeelding", other: "afbeeldingen" })}`,
};
