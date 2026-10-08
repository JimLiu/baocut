import type { JobsLibraryMessages } from './job-library.ts';

export const ja: JobsLibraryMessages = {
  serviceNoGlossaries: '外部サービスのクライアントはユーザライブラリの用語集を使用できません',
  serviceNoVoices: '外部サービスのクライアントはユーザライブラリの声を使用できません',
  noLibraryForGlossaries: 'この Runtime にはユーザライブラリがないため、用語集を使用できません',
  noLibraryForVoices: 'この Runtime にはユーザライブラリがないため、ライブラリの声を使用できません',
  translationGlossary: (p: { name: string }) => `「${p.name}」は翻訳用の用語集のため、文字起こしには使用できません`,
};
