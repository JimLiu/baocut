import type { JobsVideoTargetMessages } from './video-target.ts';

export const de: JobsVideoTargetMessages = {
  stepLabel: "Ziel auflösen",
  notSameVideo: "verweist auf ein anderes Video als videoId",
  targetShapeOneOf: "muss { videoId }, { entryId } oder { create } sein",
  createUnsupported: "Diese Pipeline kann kein Video erstellen: ein vorhandenes Video angeben (videoId oder entryId)",
  createShape: "muss { projectId, name? } oder { conversationId, name? } sein",
  mediaNotAllowed: "darf nicht angegeben werden: die Medien sind das Ergebnis dieser Pipeline",
  unknownField: (p: { key: string }) => `enthält ein unbekanntes Feld ${p.key}`,
  scopeOnlyOne: "akzeptiert nur einen der Werte projectId oder conversationId",
  scopeRequired: "benötigt projectId oder conversationId",
  nameLength: "muss 1 bis 200 Zeichen lang sein",
  mediaPath: "muss ein absoluter Pfad zu einer lokalen Mediendatei sein",
};
