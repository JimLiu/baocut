import type { JobsLibraryMessages } from './job-library.ts';

export const de: JobsLibraryMessages = {
  serviceNoGlossaries: "Clients externer Dienste können keine Glossare aus der Benutzerbibliothek verwenden",
  serviceNoVoices: "Clients externer Dienste können keine Stimmen aus der Benutzerbibliothek verwenden",
  noLibraryForGlossaries: "Diese Runtime hat keine Benutzerbibliothek; Glossare können daher nicht verwendet werden",
  noLibraryForVoices: "Diese Runtime hat keine Benutzerbibliothek; Stimmen aus der Bibliothek können daher nicht verwendet werden",
  translationGlossary: (p: { name: string }) => `„${p.name}“ ist ein Übersetzungsglossar und kann nicht zur Transkription verwendet werden`,
};
