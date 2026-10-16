import type { SaveDownloadMessages } from './save-download-copy.ts';

export const fr: SaveDownloadMessages = {
  saved: (path) => `Enregistré dans ${path}`,
  failed: (reason) => `Impossible d’enregistrer : ${reason}`,
};
