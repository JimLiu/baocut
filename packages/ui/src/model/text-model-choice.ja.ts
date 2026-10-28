import type { TextModelChoiceMessages } from './text-model-choice.ts';

export const ja: TextModelChoiceMessages = {
  placeholder: 'テキストモデルを選択',
  providers: 'プロバイダ',
  agentReady: (provider) => `Agent · ${provider} のサブスクリプションを使用 · API より遅い`,
  agentNote: (note) => `Agent · ${note}`,
  connected: (n) => `接続済み · ${n} 個のモデル`,
  notConnected: '未接続 · 設定で接続',
  settings: 'テキストモデルを管理…',
  settingsSub: 'API プロバイダを接続 · 既定のモデル',
};
