import type { ModelsModelAssetsMessages } from './model-assets.ts';

export const zhHans: ModelsModelAssetsMessages = {
  appFileMissing: (p: { what: string }) => `应用自带的${p.what}缺失或读不出来，BaoCut 的安装不完整：请重新安装 BaoCut`,
};
