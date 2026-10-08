import type { JobsGeneratedImportMessages } from './generated-import.ts';

export const ko: JobsGeneratedImportMessages = {
  voiceOverName: (p: { head: string }) => `더빙: ${p.head}`,
  imageName: (p: { head: string }) => `이미지: ${p.head}`,
};
