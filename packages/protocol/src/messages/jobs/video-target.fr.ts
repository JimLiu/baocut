import type { JobsVideoTargetMessages } from './video-target.ts';

export const fr: JobsVideoTargetMessages = {
  stepLabel: "Résoudre la cible",
  notSameVideo: "désigne une autre vidéo que videoId",
  targetShapeOneOf: "doit être { videoId }, { entryId } ou { create }",
  createUnsupported: "Ce flux ne peut pas créer de vidéo : indiquez une vidéo existante (videoId ou entryId)",
  createShape: "doit être { projectId, name? } ou { conversationId, name? }",
  mediaNotAllowed: "ne peut pas être indiqué : le média est le résultat de ce flux",
  unknownField: (p: { key: string }) => `a un champ inconnu ${p.key}`,
  scopeOnlyOne: "accepte un seul choix parmi projectId et conversationId",
  scopeRequired: "nécessite projectId ou conversationId",
  nameLength: "doit contenir de 1 à 200 caractères",
  mediaPath: "doit être un chemin absolu vers un fichier média local",
};
