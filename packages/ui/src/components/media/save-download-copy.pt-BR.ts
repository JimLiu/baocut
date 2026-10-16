import type { SaveDownloadMessages } from './save-download-copy.ts';

export const ptBR: SaveDownloadMessages = {
  saved: (path) => `Salvo em ${path}`,
  failed: (reason) => `Não foi possível salvar: ${reason}`,
};
