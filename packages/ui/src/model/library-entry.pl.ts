import type { LibraryEntryMessages } from './library-entry.ts';

export const pl: LibraryEntryMessages = {
  versionConflict: 'Ten wpis został właśnie zmieniony w innym miejscu, więc Twoja zmiana nie została zapisana. Wczytano najnowszą wersję. Wprowadź zmianę ponownie.',
  failed: (action: string, message: string) => `Nie udało się wykonać działania „${action}”: ${message}`,
};
