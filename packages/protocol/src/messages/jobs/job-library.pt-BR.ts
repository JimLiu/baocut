import type { JobsLibraryMessages } from './job-library.ts';

export const ptBR: JobsLibraryMessages = {
  serviceNoGlossaries: "Clientes de serviços externos não podem usar glossários da biblioteca do usuário",
  serviceNoVoices: "Clientes de serviços externos não podem usar vozes da biblioteca do usuário",
  noLibraryForGlossaries: "Este Runtime não tem biblioteca do usuário, então não é possível usar glossários",
  noLibraryForVoices: "Este Runtime não tem biblioteca do usuário, então não é possível usar vozes da biblioteca",
  translationGlossary: (p: { name: string }) => `“${p.name}” é um glossário de tradução e não pode ser usado para transcrição`,
};
