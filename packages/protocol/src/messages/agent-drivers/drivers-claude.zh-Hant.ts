import type { DriversClaudeMessages } from './drivers-claude.ts';

export const zhHant: DriversClaudeMessages = {
  plan: 'Claude Pro 或 Max 訂閱',
  installHint: '安裝 Claude Code',
  signedOut: 'Claude Code 尚未登入。請在終端機執行 claude，依提示登入。',
  subscriptionPro: 'Claude Pro 訂閱',
  subscriptionMax: 'Claude Max 訂閱',
  subscriptionTeam: 'Claude Team 訂閱',
  subscriptionEnterprise: 'Claude Enterprise 訂閱',
  providerAnthropicAws: 'Anthropic（AWS）',
  providerAnthropicGoogleCloud: 'Anthropic（Google Cloud）',
  enterpriseGateway: '企業閘道',
  claudeAccount: 'Claude 帳號',
  longLivedToken: 'Claude 訂閱（長期權杖）',
  apiKey: 'Anthropic API 金鑰',
  thirdPartyCloud: '第三方雲端',
  fromSettings: (p) => `來自 Claude Code 設定（env.${p.key}）`,
  imageUnsupported: (p) => `Claude 不支援這種圖片格式：${p.mimeType}（支援 JPEG、PNG、GIF、WebP）`,
  defaultModel: '預設模型',
  switchModelFailed: (p) => `Claude 無法切換模型（${p.model}）：${p.error}`,
  autoUnsupported: (p) =>
    `${p.model ? `模型 ${p.model} ` : '目前的模型'}不支援 Claude 的「自動」權限模式${p.reason ? `（${p.reason}）` : ''}。這一輪改以「每次詢問」執行，動手前會先詢問。`,
  apiRetry: (p) => `Claude API 發生錯誤（${p.error}），第 ${p.attempt}/${p.max} 次重試`,
  turnFailed: (p) => `Claude Code 回合失敗（${p.subtype}）`,
  exitedPlanMode: (p) =>
    `Claude Code 已依核准的方案離開計畫模式，接下來會開始修改。存取模式仍是「${p.plan}」時，這些修改會被拒絕。` +
    `要讓它繼續，請把存取模式改為「${p.edit}」或其他層級。`,
};
