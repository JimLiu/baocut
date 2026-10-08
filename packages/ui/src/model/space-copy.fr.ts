import type { SpaceEntryStatus } from '@baocut/protocol';
import type { SpaceEntryKind } from '@baocut/protocol';
import type { SpaceMessages } from './space-copy.ts';

export const fr: SpaceMessages = {
  kind: {
    video: "Vidéo",
    export: "Exporter",
    'video-file': "Média vidéo",
    image: "Images",
    audio: "Audio",
    subtitle: "Sous-titres",
    document: "Document",
    package: "Paquet vidéo",
    template: "Modèle",
  } satisfies Record<SpaceEntryKind, string>,
  categoryAll: "Tout",
  favorite: "Favoris",
  trash: "Corbeille",
  sort: { created: 'Date de création', updated: 'Date de mise à jour', recent: "Activité récente", name: "Nom", kind: "Type" },
  status: {
    generating: "Génération",
    candidate: "Candidat",
    applied: "Appliqué",
    published: "Publié",
    'source-changed': "Source modifiée",
    missing: "Manquant",
    failed: "Échec",
  } satisfies Record<SpaceEntryStatus, string>,
  statusAny: "Tous les états",
  statusNone: "Aucun état",
  noProject: "Sans projet",
  removedProject: "Projet retiré",
  conversation: (title: string) => `Session « ${title} »`,
};
