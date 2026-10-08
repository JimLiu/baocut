import type { JobsLibraryMessages } from './job-library.ts';

export const zhHans: JobsLibraryMessages = {
  serviceNoGlossaries: '对外服务的客户端不能使用用户库里的术语表',
  serviceNoVoices: '对外服务的客户端不能使用用户库里的音色',
  noLibraryForGlossaries: '这个 Runtime 没有用户库，不能使用术语表',
  noLibraryForVoices: '这个 Runtime 没有用户库，不能使用库里的音色',
  translationGlossary: (p: { name: string }) => `「${p.name}」是翻译用术语表，不能用于识别`,
};
