import type { SaveDownloadMessages } from './save-download-copy.ts';

export const ko: SaveDownloadMessages = {
  saved: (path) => `${path}에 저장했습니다`,
  failed: (reason) => `저장하지 못했습니다: ${reason}`,
};
