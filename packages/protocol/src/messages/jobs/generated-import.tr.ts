import type { JobsGeneratedImportMessages } from './generated-import.ts';

export const tr: JobsGeneratedImportMessages = {
  voiceOverName: (p: { head: string }) => `Dublaj: ${p.head}`,
  imageName: (p: { head: string }) => `Görsel: ${p.head}`,
};
