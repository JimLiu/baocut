import type { JobsGeneratedImportMessages } from './generated-import.ts';

export const it: JobsGeneratedImportMessages = {
  voiceOverName: (p: { head: string }) => `Doppiaggio: ${p.head}`,
  imageName: (p: { head: string }) => `Immagine: ${p.head}`,
};
