import type { TextModelChoiceMessages } from './text-model-choice.ts';

export const zhHans: TextModelChoiceMessages = {
  placeholder: '选一个文本模型',
  providers: '提供方',
  agentReady: (provider) => `智能体 · 用你的 ${provider} 订阅 · 比 API 慢`,
  agentNote: (note) => `智能体 · ${note}`,
  connected: (n) => `已连接 · ${n} 个模型`,
  notConnected: '未连接 · 去设置连接',
  settings: '管理文本模型…',
  settingsSub: '连接 API 提供方 · 默认模型',
};
