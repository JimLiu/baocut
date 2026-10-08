import type { ModelsDownloadSourceMessages } from './download-source.ts';

export const ja: ModelsDownloadSourceMessages = {
  invalidEndpoint: (p: { name: string }) =>
    `${p.name} は http(s):// で始まるベース URL である必要があります（認証情報、クエリパラメータ、フラグメントは含められません）`,
};
