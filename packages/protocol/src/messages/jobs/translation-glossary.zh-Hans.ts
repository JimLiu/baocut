import type { JobsTranslationGlossaryMessages } from './translation-glossary.ts';

export const zhHans: JobsTranslationGlossaryMessages = {
  serviceClient: '对外服务的客户端不能使用用户库里的术语表',
  noLibrary: '这个 Runtime 没有用户库，不能使用库里的术语表',
  duplicate: (p: { id: string }) => `glossaries 里术语表 ${p.id} 出现了两次`,
  transcriptionGlossary: (p: { name: string }) => `「${p.name}」是转写用术语表，不能用于翻译`,
  languageMismatch: (p: { name: string; source: string; target: string }) =>
    `「${p.name}」是 ${p.source} → ${p.target} 的术语表，与这次翻译的语言不符`,
  languageMismatchAnySource: (p: { name: string; target: string }) => `「${p.name}」是 任意语言 → ${p.target} 的术语表，与这次翻译的语言不符`,
  refMalformed: 'glossaryRef 的形状不对',
  refIncompleteEntry: 'glossaryRef.entries 里有不完整的条目',
  refIncompleteTerm: 'glossaryRef.terms 里有不完整的术语',
};
