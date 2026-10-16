import type { SaveDownloadMessages } from './save-download-copy.ts';

export const nl: SaveDownloadMessages = {
  saved: (path) => `Opgeslagen in ${path}`,
  failed: (reason) => `Kan niet opslaan: ${reason}`,
};
