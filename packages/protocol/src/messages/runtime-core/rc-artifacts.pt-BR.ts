import type { RcArtifactsMessages } from './rc-artifacts.ts';

export const ptBR: RcArtifactsMessages = {
  unavailable: "Os artefatos não estão disponíveis: o Open Artifact não conseguiu iniciar.",
  unavailableBecause: (p: { reason: string }) => `Os artefatos não estão disponíveis: ${p.reason}`,
  notFound: "Este artefato não foi encontrado. Ele pode ter sido excluído.",
  viewGone: "Esta visualização do artefato foi fechada. Abra o artefato novamente.",
  confirmAction: (p: { tool: string; action: string }) => `Executar “${p.action}” em um artefato (${p.tool})`,
  skillName: "Artefatos",
  skillSummary: "Crie slides, documentos, designs, planilhas e mais com o Open Artifact",
};
