import type { ModelsModelAssetsMessages } from './model-assets.ts';

export const ja: ModelsModelAssetsMessages = {
  appFileMissing: (p: { what: string }) =>
    `アプリに付属の ${p.what} が見つからないか読み取れないため、BaoCut のインストールが不完全です。BaoCut を再インストールしてください`,
};
