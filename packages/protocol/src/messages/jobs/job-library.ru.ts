import type { JobsLibraryMessages } from './job-library.ts';

export const ru: JobsLibraryMessages = {
  serviceNoGlossaries: "Клиенты внешних сервисов не могут использовать глоссарии из пользовательской библиотеки",
  serviceNoVoices: "Клиенты внешних сервисов не могут использовать голоса из пользовательской библиотеки",
  noLibraryForGlossaries: "У этого Runtime нет пользовательской библиотеки, поэтому глоссарии недоступны",
  noLibraryForVoices: "У этого Runtime нет пользовательской библиотеки, поэтому голоса из неё недоступны",
  translationGlossary: (p: { name: string }) => `«${p.name}» — глоссарий перевода, его нельзя использовать для расшифровки`,
};
