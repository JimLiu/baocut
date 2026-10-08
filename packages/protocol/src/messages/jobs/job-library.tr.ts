import type { JobsLibraryMessages } from './job-library.ts';

export const tr: JobsLibraryMessages = {
  serviceNoGlossaries: 'Dış hizmet istemcileri kullanıcı kitaplığındaki sözlükleri kullanamaz',
  serviceNoVoices: 'Dış hizmet istemcileri kullanıcı kitaplığındaki sesleri kullanamaz',
  noLibraryForGlossaries: 'Bu Runtime kullanıcı kitaplığına sahip değil; sözlükler kullanılamaz',
  noLibraryForVoices: 'Bu Runtime kullanıcı kitaplığına sahip değil; kitaplık sesleri kullanılamaz',
  translationGlossary: (p: { name: string }) => `“${p.name}” bir çeviri sözlüğüdür; yazıya dökmede kullanılamaz`,
};
