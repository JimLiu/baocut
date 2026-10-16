import type { SaveDownloadMessages } from './save-download-copy.ts';

export const tr: SaveDownloadMessages = {
  saved: (path) => `Kaydedildi: ${path}`,
  failed: (reason) => `Kaydedilemedi: ${reason}`,
};
