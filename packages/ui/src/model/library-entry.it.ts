import type { LibraryEntryMessages } from './library-entry.ts';

export const it: LibraryEntryMessages = {
  versionConflict: "Questa voce è stata appena modificata altrove, quindi la tua modifica non è stata salvata. È stata ricaricata la versione più recente. Apporta nuovamente la modifica.",
  failed: (action: string, message: string) => `Impossibile ${action}: ${message}`,
};
