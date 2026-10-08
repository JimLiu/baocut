import type { JobsGeneratedImportMessages } from './generated-import.ts';

export const de: JobsGeneratedImportMessages = {
  voiceOverName: (p: { head: string }) => `Vertonung: ${p.head}`,
  imageName: (p: { head: string }) => `Bild: ${p.head}`,
};
