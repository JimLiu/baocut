import type { ModelsModelInstallerMessages } from './model-installer.ts';

export const it: ModelsModelInstallerMessages = {
  noSpace: 'Il disco che contiene la cartella dei modelli ha esaurito lo spazio',
  noManifest: (p: { repo: string; revision: string }) => `Nessun manifesto integrato per ${p.repo}@${p.revision}`,
  untrustedManifest: (p: { repo: string }) => `${p.repo} ha un manifesto integrato privo di un sha256 attendibile`,
  noBundle: (p: { bundleId: string }) => `Nessun pacchetto di modelli corrispondente: ${p.bundleId}`,
  localFileGone: (p: { file: string }) => `Il file ${p.file} non è più dove era stato aggiunto; aggiungilo di nuovo dalla nuova posizione`,
};
