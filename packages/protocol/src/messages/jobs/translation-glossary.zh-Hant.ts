import type { JobsTranslationGlossaryMessages } from './translation-glossary.ts';

export const zhHant: JobsTranslationGlossaryMessages = {
  serviceClient: '對外服務的用戶端無法使用使用者資料庫中的術語表',
  noLibrary: '這個 Runtime 沒有使用者資料庫，因此無法使用資料庫中的術語表',
  duplicate: (p: { id: string }) => `術語表 ${p.id} 在 glossaries 中出現了兩次`,
  transcriptionGlossary: (p: { name: string }) => `「${p.name}」是轉錄用的術語表，無法用於翻譯`,
  languageMismatch: (p: { name: string; source: string; target: string }) =>
    `「${p.name}」是 ${p.source} → ${p.target} 的術語表，與這次翻譯的語言不符`,
  languageMismatchAnySource: (p: { name: string; target: string }) => `「${p.name}」是任意語言 → ${p.target} 的術語表，與這次翻譯的語言不符`,
  refMalformed: 'glossaryRef 的結構不正確',
  refIncompleteEntry: 'glossaryRef.entries 中有不完整的條目',
  refIncompleteTerm: 'glossaryRef.terms 中有不完整的術語',
};
