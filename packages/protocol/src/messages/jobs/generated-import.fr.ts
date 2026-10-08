import type { JobsGeneratedImportMessages } from './generated-import.ts';

export const fr: JobsGeneratedImportMessages = {
  voiceOverName: (p: { head: string }) => `Doublage : ${p.head}`,
  imageName: (p: { head: string }) => `Image : ${p.head}`,
};
