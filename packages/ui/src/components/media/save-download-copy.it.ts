import type { SaveDownloadMessages } from './save-download-copy.ts';

export const it: SaveDownloadMessages = {
  saved: (path) => `Salvato in ${path}`,
  failed: (reason) => `Impossibile salvare: ${reason}`,
};
