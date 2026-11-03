import type { ProvidersAgentMessages } from './providers-agent.ts';

export const zhHant: ProvidersAgentMessages = {
  codexUpgradeHint: '請更新 Codex CLI（例如 npm install -g @openai/codex@latest），然後再檢查一次',
  codexImageModel: 'Codex 影像生成（模型由 Codex 和你的帳號決定）',
  codexImageNotes:
    '使用這台電腦上已登入的 Codex 帳號生成：每次一張 PNG，一次只執行一個任務，通常需要一兩分鐘。無法指定尺寸和 seed（包含這些參數的請求會被拒絕），' +
    '像素尺寸以生成結果為準。會使用你的訂閱額度，剩餘額度不明。開啟即表示同意將提示詞傳送到你的 Codex 帳號。',
  codexImageNotesApiKey:
    "Codex 以 API key 等非 ChatGPT 訂閱方式登入：畫圖可能無法使用，費用記在該帳號上、不在訂閱內。BaoCut 不會自動選它，想試請手動選擇。每次一張 PNG，尺寸與 seed 不能指定。",
  imagesOnly: (p) => `${p.label} 只能生成圖片`,
  onePngOnly: (p) => `${p.label} 一次只生成一張 PNG，且不接受尺寸或 seed`,
  unavailable: (p) => `${p.label} 無法使用：${p.message}`,
  sessionNotStarted: (p) => `${p.label} 的對話沒有啟動：${p.error}`,
  timedOut: (p) => `${p.label} 未在 ${p.minutes} 分鐘內完成，已中斷`,
  exited: (p) => `${p.label} 意外結束：${p.message}`,
  notCompleted: (p) => `${p.label} 未完成這次生成：${p.reason}`,
  turnInterrupted: '這一輪已中斷',
  noImage: (p) => `${p.label} 沒有生成圖片`,
  imageUnavailable: (p) => `${p.label} 生成了圖片，但 BaoCut 讀不到儲存的檔案`,
  noImageReply: (p) => `${p.label} 沒有生成圖片：${p.reply}`,
  unknownError: '未知錯誤',
  processExited: '行程已結束',
  turnNotStarted: (p) => `這一輪沒有開始：${p.error}`,
  agentTextModel: "Agent 的預設模型",
  claudeUpgradeHint: "升級 Claude Code（例如 claude update），然後重新檢查", claudeTextNotes: "使用這台電腦上登入的 Claude 帳號撰寫：一次一個請求，每次開啟一個不帶工具的新 Claude Code 工作階段，所以比 API 慢。無法設定溫度、種子與輸出長度。使用的是你的訂閱額度，剩餘額度未知。開啟即表示同意將提示詞（包括其中的文稿文字）傳送到你的 Claude 帳號。", claudeTextNotesApiKey: "Claude Code 是以 API 金鑰或其他非訂閱方式登入，費用會記到該帳號，不包含在訂閱內。一次一個請求；無法設定溫度、種子與輸出長度。", codexTextNotes:
    "使用這台電腦上已登入的 Codex 帳號生成文字：一次只執行一個請求，每次開一個新的 Codex 工作階段，比 API 慢。無法指定 temperature、seed 和輸出長度。會使用你的訂閱額度，剩餘額度不明。開啟即表示同意將提示詞（包括其中的逐字稿等內容）傳送到你的 Codex 帳號。",
  codexTextNotesApiKey:
    "Codex 以 API key 等非 ChatGPT 訂閱方式登入：費用記在該帳號上、不在訂閱內。一次只執行一個請求；temperature、seed 與輸出長度不能指定。",
};
