import type { JobsLibraryMessages } from './job-library.ts';

export const it: JobsLibraryMessages = {
  serviceNoGlossaries: "I client dei servizi esterni non possono usare i glossari della libreria utente",
  serviceNoVoices: "I client dei servizi esterni non possono usare le voci della libreria utente",
  noLibraryForGlossaries: "Questo Runtime non ha una libreria utente, quindi non è possibile usare glossari",
  noLibraryForVoices: "Questo Runtime non ha una libreria utente, quindi non è possibile usare le voci della libreria",
  translationGlossary: (p: { name: string }) => `«${p.name}» è un glossario di traduzione e non può essere usato per la trascrizione`,
};
