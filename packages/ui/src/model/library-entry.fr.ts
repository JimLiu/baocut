import type { LibraryEntryMessages } from './library-entry.ts';

export const fr: LibraryEntryMessages = {
  versionConflict: "Entrée modifiée ailleurs ; votre changement non enregistré. Dernière version rechargée ; refaites la modification.",

  failed: (action: string, message: string) => `Impossible ${/^[aeiouyàâéèêëîïôöùûüœ]/i.test(action) ? 'd’' : 'de '}${action} : ${message}`,
};
