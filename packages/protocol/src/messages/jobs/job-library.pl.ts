import type { JobsLibraryMessages } from './job-library.ts';

export const pl: JobsLibraryMessages = {
  serviceNoGlossaries: "Klienci usług zewnętrznych nie mogą używać słowników z biblioteki użytkownika",
  serviceNoVoices: "Klienci usług zewnętrznych nie mogą używać głosów z biblioteki użytkownika",
  noLibraryForGlossaries: "Ten Runtime nie ma biblioteki użytkownika, więc nie można używać słowników",
  noLibraryForVoices: "Ten Runtime nie ma biblioteki użytkownika, więc nie można używać głosów z biblioteki",
  translationGlossary: (p: { name: string }) => `„${p.name}” to słownik tłumaczenia i nie można go użyć do transkrypcji`,
};
