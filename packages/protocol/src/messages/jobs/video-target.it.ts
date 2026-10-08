import type { JobsVideoTargetMessages } from './video-target.ts';

export const it: JobsVideoTargetMessages = {
  stepLabel: "Risolvi destinazione",
  notSameVideo: "si riferisce a un video diverso da videoId",
  targetShapeOneOf: "deve essere uno tra { videoId }, { entryId } o { create }",
  createUnsupported: "Questo flusso non può creare un video: indica un video esistente (videoId o entryId)",
  createShape: "deve essere { projectId, name? } o { conversationId, name? }",
  mediaNotAllowed: "non può essere indicato: il materiale multimediale è il risultato di questo flusso",
  unknownField: (p: { key: string }) => `ha un campo sconosciuto ${p.key}`,
  scopeOnlyOne: "accetta solo uno tra projectId e conversationId",
  scopeRequired: "richiede projectId o conversationId",
  nameLength: "deve contenere da 1 a 200 caratteri",
  mediaPath: "deve essere un percorso assoluto a un file multimediale locale",
};
