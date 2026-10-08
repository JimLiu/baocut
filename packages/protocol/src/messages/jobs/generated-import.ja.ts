import type { JobsGeneratedImportMessages } from './generated-import.ts';

export const ja: JobsGeneratedImportMessages = {
  voiceOverName: (p: { head: string }) => `吹き替え：${p.head}`,
  imageName: (p: { head: string }) => `画像：${p.head}`,
};
