import { pluralForm } from '@baocut/protocol';
import type { SpaceSearchDocumentKind } from '@baocut/protocol';
import type { SpaceSearchMessages } from './space-search.ts';

export const fr: SpaceSearchMessages = {
  documentKind: { speech: "Transcription", caption: "Sous-titres", translation: "Traduction", chapter: "Chapitre" } satisfies Record<
    SpaceSearchDocumentKind,
    string
  >,
  pendingVideos: (count: number) =>
    `L’index de contenu pour ${count} ${pluralForm('fr', count, { one: "vidéo", other: "vidéos" })} n’a pas fini ; vidéos absentes ou résultats obsolètes possibles`,
  indexUpdating: "Index en mise à jour ; résultats peut-être obsolètes",
  truncated: (count: number) => `Trop de correspondances ; seulement les premières ${count}`,

  notes: (notes: readonly string[]) => `${notes.join(" ; ")}.`,
  sourceTime: (clock: string) => `Horaire du média ${clock}`,
};
