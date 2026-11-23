import type { RcArtifactsMessages } from './rc-artifacts.ts';

export const ru: RcArtifactsMessages = {
  unavailable: "Артефакты недоступны: не удалось запустить Open Artifact.",
  unavailableBecause: (p: { reason: string }) => `Артефакты недоступны: ${p.reason}`,
  notFound: "Этот артефакт не найден. Возможно, он был удалён.",
  viewGone: "Этот просмотр артефакта закрыт. Откройте артефакт снова.",
  confirmAction: (p: { tool: string; action: string }) => `Выполнить «${p.action}» для артефакта (${p.tool})`,
  skillName: "Артефакты",
  skillSummary: "Слайды, документы, макеты, таблицы и другое в Open Artifact",
};
