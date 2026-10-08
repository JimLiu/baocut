import type { ModelsModelAssetsMessages } from './model-assets.ts';

export const ptBR: ModelsModelAssetsMessages = {
  appFileMissing: (p: { what: string }) => `O componente ${p.what} que acompanha o aplicativo está ausente ou não pode ser lido, então o BaoCut não está completamente instalado. Reinstale o BaoCut`,
};
