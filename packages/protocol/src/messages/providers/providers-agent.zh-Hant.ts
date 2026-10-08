import type { ProvidersAgentMessages } from './providers-agent.ts';

export const zhHant: ProvidersAgentMessages = {
  codexUpgradeHint: '請更新 Codex CLI（例如 npm install -g @openai/codex@latest），然後再檢查一次',
  codexImageModel: 'Codex 影像生成（模型由 Codex 和你的帳號決定）',
  codexImageNotes:
    '使用這台電腦上已登入的 Codex 帳號生成：每次一張 PNG，一次只執行一個任務，通常需要一兩分鐘。無法指定尺寸和 seed（包含這些參數的請求會被拒絕），' +
    '像素尺寸以生成結果為準。會使用你的訂閱額度，剩餘額度不明。開啟即表示同意將提示詞傳送到你的 Codex 帳號。',
  imagesOnly: (p) => `${p.label} 只能生成圖片`,
  onePngOnly: (p) => `${p.label} 一次只生成一張 PNG，且不接受尺寸或 seed`,
  unavailable: (p) => `${p.label} 無法使用：${p.message}`,
  sessionNotStarted: (p) => `${p.label} 的對話沒有啟動：${p.error}`,
  timedOut: (p) => `${p.label} 未在 ${p.minutes} 分鐘內完成，已中斷`,
  exited: (p) => `${p.label} 意外結束：${p.message}`,
  notCompleted: (p) => `${p.label} 未完成這次生成：${p.reason}`,
  turnInterrupted: '這一輪已中斷',
  noImage: (p) => `${p.label} 沒有生成圖片`,
  noImageReply: (p) => `${p.label} 沒有生成圖片：${p.reply}`,
  unknownError: '未知錯誤',
  processExited: '行程已結束',
  turnNotStarted: (p) => `這一輪沒有開始：${p.error}`,
};
