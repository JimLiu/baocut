import type { ModelsModelAssetsMessages } from './model-assets.ts';

export const nl: ModelsModelAssetsMessages = {
  appFileMissing: (p: { what: string }) => `${p.what} die bij de app hoort ontbreekt of is niet leesbaar, dus BaoCut is niet volledig geïnstalleerd. Installeer BaoCut opnieuw`,
};
