import type { JobsLibraryMessages } from './job-library.ts';

export const fr: JobsLibraryMessages = {
  serviceNoGlossaries: "Les clients de services externes ne peuvent pas utiliser les glossaires de la bibliothèque utilisateur",
  serviceNoVoices: "Les clients de services externes ne peuvent pas utiliser les voix de la bibliothèque utilisateur",
  noLibraryForGlossaries: "Ce Runtime n’a pas de bibliothèque utilisateur ; les glossaires sont indisponibles",
  noLibraryForVoices: "Ce Runtime n’a pas de bibliothèque utilisateur ; les voix de bibliothèque sont indisponibles",
  translationGlossary: (p: { name: string }) => `« ${p.name} » est un glossaire de traduction et ne peut pas être utilisé pour la transcription`,
};
