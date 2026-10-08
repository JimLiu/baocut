import type { ModelsModelAssetsMessages } from './model-assets.ts';

export const it: ModelsModelAssetsMessages = {
  appFileMissing: (p: { what: string }) => `Il componente ${p.what} incluso nell’app manca o non è leggibile, quindi BaoCut non è completamente installato. Reinstalla BaoCut`,
};
