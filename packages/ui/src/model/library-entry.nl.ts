import type { LibraryEntryMessages } from './library-entry.ts';
export const nl: LibraryEntryMessages = { versionConflict: 'Dit item is zojuist ergens anders gewijzigd, dus je wijziging is niet opgeslagen. De nieuwste versie is opnieuw geladen. Breng je wijziging opnieuw aan.', failed: (action, message) => `Kan ‘${action}’ niet uitvoeren: ${message}` };
