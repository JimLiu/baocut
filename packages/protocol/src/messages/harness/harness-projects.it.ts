import type { HarnessProjectsMessages } from './harness-projects.ts';

export const it: HarnessProjectsMessages = {
  conversationNotFound: (p) => `Sessione non trovata: ${p.id}`,
  projectNotFound: (p) => `Progetto non trovato: ${p.id}`,
  folderInaccessible: (p) => `La cartella non esiste o non è accessibile: ${p.dir}`,
  markerReadFailed: (p) => `Impossibile leggere il marcatore del progetto: ${p.error}`,
  markerNewer: (p) => `Questo progetto è stato creato da una versione più recente di BaoCut (versione del marcatore del progetto ${p.version}). Aggiorna BaoCut e aprilo di nuovo`,
  untitledProject: "Progetto senza titolo",
  createFolderFailed: (p) => `Impossibile creare la cartella del progetto: ${p.error}`,
  tooManySameName: "Troppe cartelle di progetto hanno questo nome. Scegli un altro nome",
  markerNotWritable: (p) => `La cartella del progetto non è scrivibile, quindi non è stato possibile scrivere il marcatore .bcut/project.json: ${p.dir}`,
  markerWriteFailed: (p) => `Impossibile scrivere il marcatore del progetto: ${p.error}`,
};
