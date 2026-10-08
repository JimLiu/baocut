import type { JobsVideoTargetMessages } from './video-target.ts';

export const pl: JobsVideoTargetMessages = {
  stepLabel: "Ustalanie celu",
  notSameVideo: "odwołuje się do innego wideo niż videoId",
  targetShapeOneOf: "musi być jedną z wartości { videoId }, { entryId } lub { create }",
  createUnsupported: "Ten potok nie może utworzyć wideo: podaj istniejące wideo (videoId lub entryId)",
  createShape: "musi być { projectId, name? } lub { conversationId, name? }",
  mediaNotAllowed: "nie można podać: multimedia są wynikiem tego potoku",
  unknownField: (p: { key: string }) => `ma nieznane pole ${p.key}`,
  scopeOnlyOne: "akceptuje tylko jedną z wartości projectId i conversationId",
  scopeRequired: "wymaga projectId lub conversationId",
  nameLength: "musi mieć od 1 do 200 znaków",
  mediaPath: "musi być ścieżką bezwzględną do lokalnego pliku multimediów",
};
