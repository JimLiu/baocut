import type { ModelsModelAssetsMessages } from './model-assets.ts';

export const fr: ModelsModelAssetsMessages = {
  appFileMissing: (p: { what: string }) => `La version de ${p.what} fourni avec l’application est absent ou illisible ; BaoCut n’est pas complètement installé. Réinstallez BaoCut`,
};
