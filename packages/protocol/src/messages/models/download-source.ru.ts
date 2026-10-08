import type { ModelsDownloadSourceMessages } from './download-source.ts';

export const ru: ModelsDownloadSourceMessages = {
  invalidEndpoint: (p: { name: string }) => `${p.name} должен быть базовым URL, начинающимся с http(s)://, без учётных данных, параметров запроса и фрагмента`,
};
