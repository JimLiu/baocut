import type { SaveDownloadMessages } from './save-download-copy.ts';

export const vi: SaveDownloadMessages = {
  saved: (path) => `Đã lưu vào ${path}`,
  failed: (reason) => `Không lưu được: ${reason}`,
};
