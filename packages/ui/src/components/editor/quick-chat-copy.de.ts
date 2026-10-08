import type { QuickChatMessages } from './quick-chat-copy.ts';

export const de: QuickChatMessages = {
  label: "Sitzung dieses Videos",
  open: "Sitzung dieses Videos öffnen",
  fresh: "Neue Sitzung",
  expand: "Sitzung links erweitern",
  minimize: "Minimieren",
  about: (name: string) => `Über „${name}“`,
  placeholder: "Was möchten Sie mit diesem Video tun? / eingeben für Werkzeuge",
  hint: "Der Agent bearbeitet es hier",
  failed: (message: string) => `Senden fehlgeschlagen: ${message}`,
  untitled: "Video",
  send: "Senden",
};
