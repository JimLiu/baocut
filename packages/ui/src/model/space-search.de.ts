import type { SpaceSearchDocumentKind } from "@baocut/protocol";
import { pluralForm } from '@baocut/protocol';
import type { SpaceSearchMessages } from './space-search.ts';

export const de: SpaceSearchMessages = {
  documentKind: { speech: "Transkript", caption: "Untertitel", translation: "Übersetzung", chapter: "Kapitel" } satisfies Record<
    SpaceSearchDocumentKind,
    string
  >,
  pendingVideos: (count: number) =>
    `Der Inhaltsindex für ${count} ${pluralForm('de', count, { one: "Video", other: "Videos" })} wird noch aktualisiert; Ergebnisse könnten Videos auslassen oder veraltet sein`,
  indexUpdating: "Inhaltsindex wird aktualisiert; Ergebnisse könnten veraltet sein",
  truncated: (count: number) => `Zu viele Treffer; zeigt nur die ersten ${count}`,

  notes: (notes: readonly string[]) => `${notes.join("; ")}.`,
  sourceTime: (clock: string) => `Materialzeit ${clock}`,
};
