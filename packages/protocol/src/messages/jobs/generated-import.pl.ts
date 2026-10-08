import type { JobsGeneratedImportMessages } from './generated-import.ts';

export const pl: JobsGeneratedImportMessages = {
  voiceOverName: (p: { head: string }) => `Dubbing: ${p.head}`,
  imageName: (p: { head: string }) => `Obraz: ${p.head}`,
};
