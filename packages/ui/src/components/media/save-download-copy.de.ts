import type { SaveDownloadMessages } from './save-download-copy.ts';

export const de: SaveDownloadMessages = {
  saved: (path) => `Gespeichert unter ${path}`,
  failed: (reason) => `Speichern fehlgeschlagen: ${reason}`,
};
