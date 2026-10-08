import type { ToolsModelsMessages } from './tools-models.ts';

export const zhHant: ToolsModelsMessages = {
  notConnected: '未連接',
  unavailable: '無法使用',
  notDownloaded: '未下載',
  unsupported: '此平台或版本無法使用',
  auto: '自動',
  anyLanguage: '多種語言',
  languages: (named) => named.join('、'),
  languagesMore: (first, total) => `${first.join('、')}，另有 ${total - first.length} 種`,
};
