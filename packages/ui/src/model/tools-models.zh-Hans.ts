import type { ToolsModelsMessages } from './tools-models.ts';

export const zhHans: ToolsModelsMessages = {
  notConnected: '未连接',
  unavailable: '不可用',
  notDownloaded: '未下载',
  unsupported: '此平台或构建暂不可用',
  auto: '自动',
  anyLanguage: '多种语言',
  languages: (named) => named.join('、'),
  languagesMore: (first, total) => `${first.join('、')}等 ${total} 种`,
};
