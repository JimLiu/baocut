import type { RcArtifactsMessages } from './rc-artifacts.ts';

export const ko: RcArtifactsMessages = {
  unavailable: "아티팩트를 사용할 수 없습니다: Open Artifact를 시작하지 못했습니다.",
  unavailableBecause: (p: { reason: string }) => `아티팩트를 사용할 수 없습니다: ${p.reason}`,
  notFound: "이 아티팩트를 찾을 수 없습니다. 삭제되었을 수 있습니다.",
  viewGone: "이 아티팩트 보기가 닫혔습니다. 아티팩트를 다시 여세요.",
  confirmAction: (p: { tool: string; action: string }) => `아티팩트에서 “${p.action}” 실행(${p.tool})`,
  skillName: "아티팩트",
  skillSummary: "Open Artifact로 슬라이드, 문서, 디자인, 표 등을 만듭니다",
};
