import type { ToolsModelsMessages } from './tools-models.ts';

export const ja: ToolsModelsMessages = {
  notConnected: '未接続',
  unavailable: '利用不可',
  notDownloaded: '未ダウンロード',
  unsupported: 'このプラットフォームまたはビルドでは利用できません',
  auto: '自動',
  anyLanguage: '多言語',
  languages: (named) => named.join('、'),
  languagesMore: (first, total) => `${first.join('、')} ほか ${total - first.length} 言語`,
};
