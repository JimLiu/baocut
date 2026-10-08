import type { ModelsDownloadSourceMessages } from './download-source.ts';

export const zhHant: ModelsDownloadSourceMessages = {
  invalidEndpoint: (p: { name: string }) => `${p.name} 必須是以 http(s):// 開頭的基礎 URL，不含憑證、查詢參數或片段`,
};
