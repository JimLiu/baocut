import type { LibraryEntryMessages } from './library-entry.ts';
export const es: LibraryEntryMessages = {
 versionConflict: 'Este elemento acaba de cambiar en otro lugar, por lo que tu edición no se guardó. Se ha recargado la versión más reciente. Vuelve a hacer el cambio.',
 failed: (action, message) => `No se pudo ${action}: ${message}`,
};
