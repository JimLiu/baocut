import { pluralForm } from '@baocut/protocol';
import type { TaskFactsMessages } from './task-facts.ts';

export const pl: TaskFactsMessages = {
  fact: {
    kind: "Typ",
    submitter: "Uruchomione przez",
    status: "Stan",
    startedAt: "Rozpoczęto",
    runsOn: "Działa na",
    language: "Język",
    request: "Instrukcje",
    phase: "Etap",
    images: "Obrazy",
    took: "Czas trwania",
    left: "Pozostały czas",
    cost: "Koszt",
  },
  imageCount: (count: number) => pluralForm('pl', count, { one: `${count} obraz`, few: `${count} obrazy`, many: `${count} obrazów`, other: `${count} obrazu` }),
};
