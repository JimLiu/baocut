import type { VideoBarMessages } from './video-bar-copy.ts';

export const de: VideoBarMessages = {
  closeToSpace: "Video schließen · zurück zu Space",
  untitled: "Video",
  rename: "Video umbenennen",
  details: "Videodetails",
  actions: "Videoaktionen",
  showInSpace: "In Space anzeigen",
  revealVideoFolder: "Videoordner anzeigen",
  close: "Video schließen",
  nameLabel: "Name",
  save: "Speichern",
  openFailed: "Öffnen nicht möglich",
  stale: "Noch nicht synchron · derzeit nicht bearbeitbar",
  openingAria: "Wird geöffnet",
  opening: "Wird geöffnet…",
  savingAria: "Wird gespeichert",
  saving: "Wird gespeichert…",
  agentChanged: (label: string) => `Der Agent hat das Video geändert: ${label}`,
  savedByAgent: (label: string) => `Gespeichert · Agent: ${label}`,
  saved: "Gespeichert",
};
