import type { ModelsModelAssetsMessages } from './model-assets.ts';

export const ru: ModelsModelAssetsMessages = {
  appFileMissing: (p: { what: string }) => `Компонент ${p.what}, поставляемый с приложением, отсутствует или не читается. Установка BaoCut неполная. Переустановите BaoCut`,
};
