import type { SaveDownloadMessages } from './save-download-copy.ts';

export const es: SaveDownloadMessages = {
  saved: (path) => `Guardado en ${path}`,
  failed: (reason) => `No se pudo guardar: ${reason}`,
};
