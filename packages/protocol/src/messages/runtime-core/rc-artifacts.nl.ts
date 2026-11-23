import type { RcArtifactsMessages } from './rc-artifacts.ts';

export const nl: RcArtifactsMessages = {
  unavailable: "Artefacten zijn niet beschikbaar: Open Artifact kon niet starten.",
  unavailableBecause: (p: { reason: string }) => `Artefacten zijn niet beschikbaar: ${p.reason}`,
  notFound: "Dit artefact is niet gevonden. Het is mogelijk verwijderd.",
  viewGone: "Deze weergave van het artefact is gesloten. Open het artefact opnieuw.",
  confirmAction: (p: { tool: string; action: string }) => `“${p.action}” uitvoeren op een artefact (${p.tool})`,
  skillName: "Artefacten",
  skillSummary: "Maak dia's, documenten, ontwerpen, sheets en meer met Open Artifact",
};
