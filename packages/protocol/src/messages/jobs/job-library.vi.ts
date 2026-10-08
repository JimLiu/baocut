import type { JobsLibraryMessages } from './job-library.ts';

export const vi: JobsLibraryMessages = {
  serviceNoGlossaries: 'Máy khách của dịch vụ bên ngoài không thể dùng bảng thuật ngữ trong thư viện người dùng',
  serviceNoVoices: 'Máy khách của dịch vụ bên ngoài không thể dùng giọng trong thư viện người dùng',
  noLibraryForGlossaries: 'Runtime này không có thư viện người dùng nên không thể dùng bảng thuật ngữ',
  noLibraryForVoices: 'Runtime này không có thư viện người dùng nên không thể dùng giọng trong thư viện',
  translationGlossary: (p: { name: string }) => `“${p.name}” là bảng thuật ngữ dịch, không thể dùng để chép lời`,
};
