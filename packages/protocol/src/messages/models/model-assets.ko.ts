import type { ModelsModelAssetsMessages } from './model-assets.ts';

export const ko: ModelsModelAssetsMessages = {
  appFileMissing: (p: { what: string }) =>
    `앱에 포함된 ${p.what} 파일이 없거나 읽을 수 없어 BaoCut이 완전히 설치되지 않았습니다. BaoCut을 다시 설치하세요`,
};
