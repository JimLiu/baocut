import type { JobsGeneratedImportMessages } from './generated-import.ts';

export const vi: JobsGeneratedImportMessages = {
  voiceOverName: (p: { head: string }) => `Lồng tiếng: ${p.head}`,
  imageName: (p: { head: string }) => `Hình ảnh: ${p.head}`,
};
