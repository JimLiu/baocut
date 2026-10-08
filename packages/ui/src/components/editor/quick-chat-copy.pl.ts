import type { QuickChatMessages } from './quick-chat-copy.ts';

export const pl: QuickChatMessages = {
  label: "Sesja tego wideo",
  open: "Otwórz sesję tego wideo",
  fresh: "Nowa sesja",
  expand: "Rozwiń sesję po lewej",
  minimize: "Minimalizuj",
  about: (name: string) => `O wideo „${name}”`,
  placeholder: "Co chcesz zrobić z tym wideo? Wpisz /, aby użyć narzędzi",
  hint: "Agent pracuje nad nim tutaj",
  failed: (message: string) => `Nie udało się wysłać: ${message}`,
  untitled: "Wideo",
  send: "Wyślij",
};
