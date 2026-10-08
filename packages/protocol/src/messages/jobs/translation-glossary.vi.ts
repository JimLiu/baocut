import type { JobsTranslationGlossaryMessages } from './translation-glossary.ts';

export const vi: JobsTranslationGlossaryMessages = {
serviceClient: 'Máy khách dịch vụ không thể dùng bảng thuật ngữ trong thư viện người dùng', noLibrary: 'Runtime này không có thư viện người dùng nên không thể dùng bảng thuật ngữ trong thư viện', duplicate: (p) => `Bảng thuật ngữ ${p.id} xuất hiện hai lần trong glossaries`, transcriptionGlossary: (p) => `“${p.name}” là bảng thuật ngữ chép lời, không thể dùng để dịch`, languageMismatch: (p) => `“${p.name}” là bảng thuật ngữ ${p.source} → ${p.target}, không khớp với ngôn ngữ của bản dịch này`, languageMismatchAnySource: (p) => `“${p.name}” là bảng thuật ngữ ngôn ngữ bất kỳ → ${p.target}, không khớp với ngôn ngữ của bản dịch này`, refMalformed: 'glossaryRef có cấu trúc sai', refIncompleteEntry: 'glossaryRef.entries chứa mục chưa đầy đủ', refIncompleteTerm: 'glossaryRef.terms chứa thuật ngữ chưa đầy đủ',
};
