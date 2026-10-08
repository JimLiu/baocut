import type { ModelsDownloadSourceMessages } from './download-source.ts';

export const zhHans: ModelsDownloadSourceMessages = {
  invalidEndpoint: (p: { name: string }) => `${p.name} 应为 http(s):// 开头的基址，不含凭据、查询参数与片段`,
};
