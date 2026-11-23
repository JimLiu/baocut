import type { RcArtifactsMessages } from './rc-artifacts.ts';

export const de: RcArtifactsMessages = {
  unavailable: "Artefakte sind nicht verfügbar: Open Artifact konnte nicht starten.",
  unavailableBecause: (p: { reason: string }) => `Artefakte sind nicht verfügbar: ${p.reason}`,
  notFound: "Dieses Artefakt wurde nicht gefunden. Es wurde möglicherweise gelöscht.",
  viewGone: "Diese Ansicht des Artefakts wurde geschlossen. Öffne das Artefakt erneut.",
  confirmAction: (p: { tool: string; action: string }) => `„${p.action}“ für ein Artefakt ausführen (${p.tool})`,
  skillName: "Artefakte",
  skillSummary: "Folien, Dokumente, Designs, Tabellen und mehr mit Open Artifact erstellen",
};
