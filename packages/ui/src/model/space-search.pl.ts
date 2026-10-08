import { pluralForm } from '@baocut/protocol';
import type { SpaceSearchMessages } from './space-search.ts';

export const pl: SpaceSearchMessages = {
  documentKind: { speech: "Transkrypcja", caption: "Napisy", translation: "Tłumaczenie", chapter: "Rozdział" },
  pendingVideos: (count: number) => pluralForm('pl', count, { one: `Indeks treści ${count} wideo nie został jeszcze zaktualizowany; w wynikach może brakować wideo lub mogą być nieaktualne`, few: `Indeks treści ${count} wideo nie został jeszcze zaktualizowany; w wynikach może brakować wideo lub mogą być nieaktualne`, many: `Indeks treści ${count} wideo nie został jeszcze zaktualizowany; w wynikach może brakować wideo lub mogą być nieaktualne`, other: `Indeks treści ${count} wideo nie został jeszcze zaktualizowany; w wynikach może brakować wideo lub mogą być nieaktualne` }),
  indexUpdating: "Indeks treści jest aktualizowany; wyniki mogą być nieaktualne",
  truncated: (count: number) => `Zbyt wiele wyników; pokazano tylko pierwsze ${count}`,
  notes: (notes: readonly string[]) => `${notes.join("; ")}.`,
  sourceTime: (clock: string) => `Czas materiału ${clock}`,
};
