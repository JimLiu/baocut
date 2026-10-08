import type { LibraryEntryMessages } from './library-entry.ts';

export const de: LibraryEntryMessages = {
  versionConflict: "Dieser Eintrag wurde gerade anderswo geändert; Bearbeitung nicht gespeichert. Aktuelle Version neu geladen. Änderung erneut vornehmen.",

  failed: (action: string, message: string) => `Fehlgeschlagen: ${action}: ${message}`,
};
