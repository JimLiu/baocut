import type { ModelsDownloadSourceMessages } from './download-source.ts';

export const nl: ModelsDownloadSourceMessages = {
  invalidEndpoint: (p: { name: string }) => `${p.name} moet een basis-URL zijn die begint met http(s)://, zonder inloggegevens, queryparameters of fragment`,
};
