import type { JobsTranslationGlossaryMessages } from './translation-glossary.ts';

export const ko: JobsTranslationGlossaryMessages = {
  serviceClient: '서비스 클라이언트는 사용자 라이브러리의 용어집을 사용할 수 없습니다',
  noLibrary: '이 Runtime에는 사용자 라이브러리가 없어 라이브러리 용어집을 사용할 수 없습니다',
  duplicate: (p: { id: string }) => `glossaries에 ${p.id} 용어집이 두 번 나옵니다`,
  transcriptionGlossary: (p: { name: string }) => `“${p.name}” 용어집은 전사용이라 번역에 사용할 수 없습니다`,
  languageMismatch: (p: { name: string; source: string; target: string }) =>
    `“${p.name}” 용어집은 ${p.source} → ${p.target} 용어집이라 이 번역의 언어와 맞지 않습니다`,
  languageMismatchAnySource: (p: { name: string; target: string }) =>
    `“${p.name}” 용어집은 모든 언어 → ${p.target} 용어집이라 이 번역의 언어와 맞지 않습니다`,
  refMalformed: 'glossaryRef의 형식이 잘못되었습니다',
  refIncompleteEntry: 'glossaryRef.entries에 불완전한 항목이 있습니다',
  refIncompleteTerm: 'glossaryRef.terms에 불완전한 용어가 있습니다',
};
