import type { RcArtifactsMessages } from './rc-artifacts.ts';

export const es: RcArtifactsMessages = {
  unavailable: "Los artefactos no están disponibles: Open Artifact no pudo iniciarse.",
  unavailableBecause: (p: { reason: string }) => `Los artefactos no están disponibles: ${p.reason}`,
  notFound: "No se encontró este artefacto. Es posible que se haya eliminado.",
  viewGone: "Esta vista del artefacto se cerró. Vuelve a abrir el artefacto.",
  confirmAction: (p: { tool: string; action: string }) => `Ejecutar “${p.action}” en un artefacto (${p.tool})`,
  skillName: "Artefactos",
  skillSummary: "Crea diapositivas, documentos, diseños, hojas y más con Open Artifact",
};
