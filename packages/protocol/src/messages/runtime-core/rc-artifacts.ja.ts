import type { RcArtifactsMessages } from './rc-artifacts.ts';

export const ja: RcArtifactsMessages = {
  unavailable: "アーティファクトを利用できません: Open Artifact を起動できませんでした。",
  unavailableBecause: (p: { reason: string }) => `アーティファクトを利用できません: ${p.reason}`,
  notFound: "このアーティファクトが見つかりません。削除された可能性があります。",
  viewGone: "このアーティファクトの表示は閉じられました。もう一度開いてください。",
  confirmAction: (p: { tool: string; action: string }) => `アーティファクトで「${p.action}」を実行（${p.tool}）`,
  skillName: "アーティファクト",
  skillSummary: "Open Artifact でスライド、ドキュメント、デザイン、表などを作成",
};
