import type { JobsLibraryMessages } from './job-library.ts';

export const ko: JobsLibraryMessages = {
  serviceNoGlossaries: '외부 서비스의 클라이언트는 사용자 라이브러리의 용어집을 사용할 수 없습니다',
  serviceNoVoices: '외부 서비스의 클라이언트는 사용자 라이브러리의 목소리를 사용할 수 없습니다',
  noLibraryForGlossaries: '이 Runtime에는 사용자 라이브러리가 없어 용어집을 사용할 수 없습니다',
  noLibraryForVoices: '이 Runtime에는 사용자 라이브러리가 없어 라이브러리 목소리를 사용할 수 없습니다',
  translationGlossary: (p: { name: string }) => `“${p.name}” 용어집은 번역용이라 전사에 사용할 수 없습니다`,
};
