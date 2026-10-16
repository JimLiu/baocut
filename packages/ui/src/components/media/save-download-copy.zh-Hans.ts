import type { SaveDownloadMessages } from './save-download-copy.ts';

export const zhHans: SaveDownloadMessages = {
  saved: (path) => `已保存到 ${path}`,
  failed: (reason) => `没能保存：${reason}`,
};
