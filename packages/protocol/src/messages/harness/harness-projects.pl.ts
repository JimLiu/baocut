import type { HarnessProjectsMessages } from './harness-projects.ts';

export const pl: HarnessProjectsMessages = {
  conversationNotFound: (p) => `Nie znaleziono sesji: ${p.id}`,
  projectNotFound: (p) => `Nie znaleziono projektu: ${p.id}`,
  folderInaccessible: (p) => `Folder nie istnieje lub jest niedostępny: ${p.dir}`,
  markerReadFailed: (p) => `Nie udało się odczytać znacznika projektu: ${p.error}`,
  markerNewer: (p) => `Ten projekt utworzono w nowszej wersji BaoCut (wersja znacznika projektu ${p.version}). Zaktualizuj BaoCut, a następnie otwórz go ponownie`,
  untitledProject: "Projekt bez tytułu",
  createFolderFailed: (p) => `Nie udało się utworzyć folderu projektu: ${p.error}`,
  tooManySameName: "Zbyt wiele folderów projektów ma tę nazwę. Wybierz inną",
  markerNotWritable: (p) => `Folder projektu jest niezapisywalny, więc nie można zapisać znacznika projektu .bcut/project.json: ${p.dir}`,
  markerWriteFailed: (p) => `Nie udało się zapisać znacznika projektu: ${p.error}`,
};
