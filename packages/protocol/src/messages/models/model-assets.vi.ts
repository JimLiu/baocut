import type { ModelsModelAssetsMessages } from './model-assets.ts';

export const vi: ModelsModelAssetsMessages = {
  appFileMissing: (p: { what: string }) => `${p.what} đi kèm ứng dụng bị thiếu hoặc không đọc được nên BaoCut chưa được cài đầy đủ. Cài lại BaoCut`,
};
