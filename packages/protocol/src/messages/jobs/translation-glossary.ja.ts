import type { JobsTranslationGlossaryMessages } from './translation-glossary.ts';

export const ja: JobsTranslationGlossaryMessages = {
  serviceClient: 'サービスのクライアントはユーザライブラリの用語集を使用できません',
  noLibrary: 'この Runtime にはユーザライブラリがないため、ライブラリの用語集を使用できません',
  duplicate: (p: { id: string }) => `glossaries に用語集 ${p.id} が 2 回含まれています`,
  transcriptionGlossary: (p: { name: string }) => `「${p.name}」は文字起こし用の用語集のため、翻訳には使用できません`,
  languageMismatch: (p: { name: string; source: string; target: string }) =>
    `「${p.name}」は ${p.source} → ${p.target} の用語集のため、この翻訳の言語と一致しません`,
  languageMismatchAnySource: (p: { name: string; target: string }) =>
    `「${p.name}」は任意の言語 → ${p.target} の用語集のため、この翻訳の言語と一致しません`,
  refMalformed: 'glossaryRef の形式が正しくありません',
  refIncompleteEntry: 'glossaryRef.entries に不完全な項目があります',
  refIncompleteTerm: 'glossaryRef.terms に不完全な用語があります',
};
