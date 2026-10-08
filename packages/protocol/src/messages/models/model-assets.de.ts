import type { ModelsModelAssetsMessages } from './model-assets.ts';

export const de: ModelsModelAssetsMessages = {
  appFileMissing: (p: { what: string }) => `${p.what} aus der App fehlt oder ist nicht lesbar. BaoCut ist daher nicht vollständig installiert. BaoCut erneut installieren`,
};
