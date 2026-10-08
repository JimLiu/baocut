import type { ModelsModelAssetsMessages } from './model-assets.ts';

export const zhHant: ModelsModelAssetsMessages = {
  appFileMissing: (p: { what: string }) => `應用程式隨附的${p.what}遺失或無法讀取，因此 BaoCut 安裝不完整。請重新安裝 BaoCut`,
};
