import type { SaveDownloadMessages } from './save-download-copy.ts';

export const pl: SaveDownloadMessages = {
  saved: (path) => `Zapisano w ${path}`,
  failed: (reason) => `Nie udało się zapisać: ${reason}`,
};
