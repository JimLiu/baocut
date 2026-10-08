import type { HarnessProjectsMessages } from './harness-projects.ts';

export const fr: HarnessProjectsMessages = {
  conversationNotFound: (p: { id: string }) => `Session introuvable : ${p.id}`,
  projectNotFound: (p: { id: string }) => `Projet introuvable : ${p.id}`,
  folderInaccessible: (p: { dir: string }) => `Dossier inexistant ou inaccessible : ${p.dir}`,
  markerReadFailed: (p: { error: string }) => `Impossible de lire le marqueur de projet : ${p.error}`,
  markerNewer: (p: { version: number }) =>
    `Ce projet a été créé par une version plus récente de BaoCut (version du marqueur ${p.version}). Mettez BaoCut à jour, puis rouvrez-le`,

  untitledProject: "Projet sans titre",
  createFolderFailed: (p: { error: string }) => `Impossible de créer le dossier du projet : ${p.error}`,
  tooManySameName: "Trop de dossiers de projet portent ce nom. Choisissez un autre nom",
  markerNotWritable: (p: { dir: string }) =>
    `Le dossier du projet n’est pas accessible en écriture ; impossible d’écrire .bcut/project.json : ${p.dir}`,
  markerWriteFailed: (p: { error: string }) => `Impossible d’écrire le marqueur de projet : ${p.error}`,
};
