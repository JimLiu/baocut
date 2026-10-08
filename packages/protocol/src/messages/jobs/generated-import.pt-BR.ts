import type { JobsGeneratedImportMessages } from './generated-import.ts';

export const ptBR: JobsGeneratedImportMessages = {
  voiceOverName: (p: { head: string }) => `Dublagem: ${p.head}`,
  imageName: (p: { head: string }) => `Imagem: ${p.head}`,
};
