import type { VideoBarMessages } from './video-bar-copy.ts';

export const pl: VideoBarMessages = {
  closeToSpace: "Zamknij wideo · wróć do Space",
  untitled: "Wideo",
  rename: "Zmień nazwę wideo",
  details: "Szczegóły wideo",
  actions: "Działania wideo",
  showInSpace: "Pokaż w Space",
  revealVideoFolder: "Pokaż folder wideo",
  close: "Zamknij wideo",
  nameLabel: "Nazwa",
  save: "Zapisz",
  openFailed: "Nie można otworzyć",
  stale: "Niezsynchronizowane · nie można teraz edytować",
  openingAria: "Otwieranie",
  opening: "Otwieranie…",
  savingAria: "Zapisywanie",
  saving: "Zapisywanie…",
  agentChanged: (label: string) => `Agent zmienił wideo: ${label}`,
  savedByAgent: (label: string) => `Zapisano · agent: ${label}`,
  saved: "Zapisano",
};
