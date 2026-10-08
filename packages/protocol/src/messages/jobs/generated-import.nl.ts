import type { JobsGeneratedImportMessages } from './generated-import.ts';

export const nl: JobsGeneratedImportMessages = {
  voiceOverName: (p: { head: string }) => `Nasynchronisatie: ${p.head}`,
  imageName: (p: { head: string }) => `Afbeelding: ${p.head}`,
};
