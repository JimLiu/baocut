import type { DriversClaudeMessages } from './drivers-claude.ts';

export const ja: DriversClaudeMessages = {
  plan: 'Claude Pro または Max サブスクリプション',
  installHint: 'Claude Code をインストールしてください',
  signedOut: 'Claude Code はサインインしていません。ターミナルで claude を実行し、表示に従ってサインインしてください。',
  subscriptionPro: 'Claude Pro サブスクリプション',
  subscriptionMax: 'Claude Max サブスクリプション',
  subscriptionTeam: 'Claude Team サブスクリプション',
  subscriptionEnterprise: 'Claude Enterprise サブスクリプション',
  providerAnthropicAws: 'Anthropic（AWS）',
  providerAnthropicGoogleCloud: 'Anthropic（Google Cloud）',
  enterpriseGateway: 'エンタープライズゲートウェイ',
  claudeAccount: 'Claude アカウント',
  longLivedToken: 'Claude サブスクリプション（長期トークン）',
  apiKey: 'Anthropic API キー',
  thirdPartyCloud: 'サードパーティクラウド',
  fromSettings: (p) => `Claude Code の設定から（env.${p.key}）`,
  imageUnsupported: (p) => `Claude はこの画像形式に対応していません：${p.mimeType}（対応形式：JPEG、PNG、GIF、WebP）`,
  defaultModel: '既定のモデル',
  switchModelFailed: (p) => `Claude のモデルを切り替えられませんでした（${p.model}）：${p.error}`,
  autoUnsupported: (p) =>
    `${p.model ? `モデル ${p.model} は` : '現在のモデルは'}Claude の「自動」権限モードに対応していません${p.reason ? `（${p.reason}）` : ''}。このターンは「毎回確認」で実行し、操作の前に確認します。`,
  apiRetry: (p) => `Claude API エラー（${p.error}）。再試行 ${p.attempt}/${p.max}`,
  turnFailed: (p) => `Claude Code のターンが失敗しました（${p.subtype}）`,
  exitedPlanMode: (p) =>
    `Claude Code は承認されたプランでプランモードを終了し、変更を始めます。アクセスモードが「${p.plan}」のままだと、これらの変更は拒否されます。` +
    `続行させるには、アクセスモードを「${p.edit}」または別のレベルに変更してください。`,
};
