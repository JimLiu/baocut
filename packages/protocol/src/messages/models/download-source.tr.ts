import type { ModelsDownloadSourceMessages } from './download-source.ts';

export const tr: ModelsDownloadSourceMessages = {
  invalidEndpoint: (p: { name: string }) => `${p.name}, http(s):// ile başlayan, kimlik bilgisi, sorgu parametresi veya parça içermeyen temel URL olmalı`,
};
