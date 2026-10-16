import type { SaveDownloadMessages } from './save-download-copy.ts';

export const zhHant: SaveDownloadMessages = {
  saved: (path) => `已儲存到 ${path}`,
  failed: (reason) => `無法儲存：${reason}`,
};
