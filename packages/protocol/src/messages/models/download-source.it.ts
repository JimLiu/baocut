import type { ModelsDownloadSourceMessages } from './download-source.ts';

export const it: ModelsDownloadSourceMessages = {
  invalidEndpoint: (p: { name: string }) => `${p.name} deve essere un URL di base che inizi con http(s)://, senza credenziali, parametri di query o frammenti`,
};
