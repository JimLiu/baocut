import type { SaveDownloadMessages } from './save-download-copy.ts';

export const ru: SaveDownloadMessages = {
  saved: (path) => `Сохранено: ${path}`,
  failed: (reason) => `Не удалось сохранить: ${reason}`,
};
