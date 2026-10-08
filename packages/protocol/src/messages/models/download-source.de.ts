import type { ModelsDownloadSourceMessages } from './download-source.ts';

export const de: ModelsDownloadSourceMessages = {
  invalidEndpoint: (p: { name: string }) => `${p.name} muss eine Basis-URL mit http(s):// sein, ohne Zugangsdaten, Abfrageparameter oder Fragment`,
};
