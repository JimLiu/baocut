import type { RcArtifactsMessages } from './rc-artifacts.ts';

export const fr: RcArtifactsMessages = {
  unavailable: "Les artefacts ne sont pas disponibles : Open Artifact n'a pas pu démarrer.",
  unavailableBecause: (p: { reason: string }) => `Les artefacts ne sont pas disponibles : ${p.reason}`,
  notFound: "Cet artefact est introuvable. Il a peut-être été supprimé.",
  viewGone: "Cette vue de l'artefact est fermée. Rouvrez l'artefact.",
  confirmAction: (p: { tool: string; action: string }) => `Exécuter « ${p.action} » sur un artefact (${p.tool})`,
  skillName: "Artefacts",
  skillSummary: "Créez diapositives, documents, maquettes, feuilles et plus avec Open Artifact",
};
