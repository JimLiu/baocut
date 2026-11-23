import type { RcArtifactsMessages } from './rc-artifacts.ts';

export const zhHant: RcArtifactsMessages = {
  unavailable: "作品暫時無法使用：Open Artifact 沒能啟動。",
  unavailableBecause: (p: { reason: string }) => `作品暫時無法使用：${p.reason}`,
  notFound: "找不到這份作品，可能已被刪除。",
  viewGone: "這個作品檢視已經關閉，請重新開啟作品。",
  confirmAction: (p: { tool: string; action: string }) => `對作品執行「${p.action}」（${p.tool}）`,
  skillName: "作品",
  skillSummary: "用 Open Artifact 製作投影片、文件、設計稿、表格等可線上編輯的作品",
};
