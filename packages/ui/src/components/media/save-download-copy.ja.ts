import type { SaveDownloadMessages } from './save-download-copy.ts';

export const ja: SaveDownloadMessages = {
  saved: (path) => `${path} に保存しました`,
  failed: (reason) => `保存できませんでした：${reason}`,
};
