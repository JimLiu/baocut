import type { JobsVideoTargetMessages } from './video-target.ts';

export const nl: JobsVideoTargetMessages = {
  stepLabel: "Doel bepalen",
  notSameVideo: "verwijst naar een andere video dan videoId",
  targetShapeOneOf: "moet { videoId }, { entryId } of { create } zijn",
  createUnsupported: "Deze pipeline kan geen video maken: geef een bestaande video op (videoId of entryId)",
  createShape: "moet { projectId, name? } of { conversationId, name? } zijn",
  mediaNotAllowed: "mag niet worden opgegeven: de media zijn het resultaat van deze pipeline",
  unknownField: (p: { key: string }) => `bevat een onbekend veld ${p.key}`,
  scopeOnlyOne: "accepteert alleen projectId of conversationId",
  scopeRequired: "vereist projectId of conversationId",
  nameLength: "moet 1 tot 200 tekens bevatten",
  mediaPath: "moet een absoluut pad naar een lokaal mediabestand zijn",
};
