import type { RcArtifactsMessages } from './rc-artifacts.ts';

export const pl: RcArtifactsMessages = {
  unavailable: "Artefakty są niedostępne: nie udało się uruchomić Open Artifact.",
  unavailableBecause: (p: { reason: string }) => `Artefakty są niedostępne: ${p.reason}`,
  notFound: "Nie znaleziono tego artefaktu. Mógł zostać usunięty.",
  viewGone: "Ten widok artefaktu został zamknięty. Otwórz artefakt ponownie.",
  confirmAction: (p: { tool: string; action: string }) => `Wykonaj „${p.action}” na artefakcie (${p.tool})`,
  skillName: "Artefakty",
  skillSummary: "Twórz slajdy, dokumenty, projekty, arkusze i więcej w Open Artifact",
};
