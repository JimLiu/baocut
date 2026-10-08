import type { ToolsModelsMessages } from './tools-models.ts';

export const ko: ToolsModelsMessages = {
  notConnected: '연결 안 됨',
  unavailable: '사용할 수 없음',
  notDownloaded: '다운로드 안 됨',
  unsupported: '이 플랫폼 또는 빌드에서는 사용할 수 없음',
  auto: '자동',
  anyLanguage: '다국어',
  languages: (named) => named.join(', '),
  languagesMore: (first, total) => `${first.join(', ')} 외 ${total - first.length}개`,
};
