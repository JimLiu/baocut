import type { DriversClaudeMessages } from './drivers-claude.ts';

export const zhHans: DriversClaudeMessages = {
  plan: 'Claude Pro 或 Max 订阅',
  installHint: '安装 Claude Code',
  signedOut: 'Claude Code 未登录：在终端运行 claude，按提示登录。',
  subscriptionPro: 'Claude Pro 订阅',
  subscriptionMax: 'Claude Max 订阅',
  subscriptionTeam: 'Claude Team 订阅',
  subscriptionEnterprise: 'Claude Enterprise 订阅',
  providerAnthropicAws: 'Anthropic（AWS）',
  providerAnthropicGoogleCloud: 'Anthropic（Google Cloud）',
  enterpriseGateway: '企业网关',
  claudeAccount: 'Claude 账号',
  longLivedToken: 'Claude 订阅（长期令牌）',
  apiKey: 'Anthropic API 密钥',
  thirdPartyCloud: '第三方云',
  fromSettings: (p) => `来自 Claude Code 设置（env.${p.key}）`,
  imageUnsupported: (p) => `Claude 不支持这种图片格式：${p.mimeType}（支持 JPEG、PNG、GIF、WebP）`,
  defaultModel: '默认模型',
  switchModelFailed: (p) => `Claude 切换模型失败（${p.model}）：${p.error}`,
  autoUnsupported: (p) =>
    `${p.model ? `模型 ${p.model}` : '当前模型'}不支持 Claude 的「自动」权限模式${p.reason ? `（${p.reason}）` : ''}，这一轮按「逐项询问」执行：操作前会先询问。`,
  apiRetry: (p) => `Claude API 出错（${p.error}），第 ${p.attempt}/${p.max} 次重试`,
  turnFailed: (p) => `Claude Code 回合失败（${p.subtype}）`,
};
