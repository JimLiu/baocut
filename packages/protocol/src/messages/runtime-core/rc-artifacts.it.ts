import type { RcArtifactsMessages } from './rc-artifacts.ts';

export const it: RcArtifactsMessages = {
  unavailable: "Gli artefatti non sono disponibili: Open Artifact non è riuscito ad avviarsi.",
  unavailableBecause: (p: { reason: string }) => `Gli artefatti non sono disponibili: ${p.reason}`,
  notFound: "Questo artefatto non è stato trovato. Potrebbe essere stato eliminato.",
  viewGone: "Questa vista dell'artefatto è stata chiusa. Riapri l'artefatto.",
  confirmAction: (p: { tool: string; action: string }) => `Eseguire “${p.action}” su un artefatto (${p.tool})`,
  skillName: "Artefatti",
  skillSummary: "Crea slide, documenti, design, fogli e altro con Open Artifact",
};
