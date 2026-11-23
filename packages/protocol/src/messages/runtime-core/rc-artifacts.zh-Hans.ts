import type { RcArtifactsMessages } from './rc-artifacts.ts';

export const zhHans: RcArtifactsMessages = {
  unavailable: "作品暂时不可用：Open Artifact 没能启动。",
  unavailableBecause: (p: { reason: string }) => `作品暂时不可用：${p.reason}`,
  notFound: "没有找到这份作品，可能已被删除。",
  viewGone: "这个作品视图已经关闭，请重新打开作品。",
  confirmAction: (p: { tool: string; action: string }) => `对作品执行「${p.action}」（${p.tool}）`,
  skillName: "作品",
  skillSummary: "用 Open Artifact 做幻灯片、文档、设计稿、表格等可在线编辑的作品",
};
