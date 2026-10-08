import type { HarnessProjectsMessages } from './harness-projects.ts';

export const nl: HarnessProjectsMessages = {
  conversationNotFound: (p: { id: string }) => `Sessie niet gevonden: ${p.id}`,
  projectNotFound: (p: { id: string }) => `Project niet gevonden: ${p.id}`,
  folderInaccessible: (p: { dir: string }) => `Map bestaat niet of is niet toegankelijk: ${p.dir}`,
  markerReadFailed: (p: { error: string }) => `Kan de projectmarkering niet lezen: ${p.error}`,
  markerNewer: (p: { version: number }) =>
    `Dit project is gemaakt met een nieuwere versie van BaoCut (projectmarkeringsversie ${p.version}). Werk BaoCut bij en open het opnieuw`,

  untitledProject: "Naamloos project",
  createFolderFailed: (p: { error: string }) => `Kan de projectmap niet maken: ${p.error}`,
  tooManySameName: "Te veel projectmappen hebben deze naam. Kies een andere naam",
  markerNotWritable: (p: { dir: string }) =>
    `De projectmap is niet schrijfbaar, dus de projectmarkering .bcut/project.json kan niet worden geschreven: ${p.dir}`,
  markerWriteFailed: (p: { error: string }) => `Kan de projectmarkering niet schrijven: ${p.error}`,
};
