import type { ModelsDownloadSourceMessages } from './download-source.ts';

export const fr: ModelsDownloadSourceMessages = {
  invalidEndpoint: (p: { name: string }) => `${p.name} doit être une URL de base http(s)://, sans identifiants, paramètres de requête ni fragment`,
};
