import type { LibraryEntryMessages } from './library-entry.ts';

export const ptBR: LibraryEntryMessages = {
  versionConflict: "Esta entrada acabou de ser alterada em outro lugar, por isso sua edição não foi salva. A versão mais recente foi recarregada. Faça sua alteração novamente.",
  failed: (action: string, message: string) => `Não foi possível ${action}: ${message}`,
};
