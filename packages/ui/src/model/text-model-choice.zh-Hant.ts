import type { TextModelChoiceMessages } from './text-model-choice.ts';

export const zhHant: TextModelChoiceMessages = {
  placeholder: '選一個文字模型',
  providers: '供應商',
  agentReady: (provider) => `智慧體 · 使用你的 ${provider} 訂閱 · 比 API 慢`,
  agentNote: (note) => `智慧體 · ${note}`,
  connected: (n) => `已連線 · ${n} 個模型`,
  notConnected: '未連線 · 到設定連線',
  settings: '管理文字模型…',
  settingsSub: '連線 API 供應商 · 預設模型',
};
