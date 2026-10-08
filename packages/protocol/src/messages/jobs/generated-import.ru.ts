import type { JobsGeneratedImportMessages } from './generated-import.ts';

export const ru: JobsGeneratedImportMessages = {
  voiceOverName: (p: { head: string }) => `Озвучка: ${p.head}`,
  imageName: (p: { head: string }) => `Изображение: ${p.head}`,
};
