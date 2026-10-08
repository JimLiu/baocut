import type { JobsLibraryMessages } from './job-library.ts';

export const nl: JobsLibraryMessages = {
  serviceNoGlossaries: "Clients van externe diensten kunnen geen woordenlijsten uit de gebruikersbibliotheek gebruiken",
  serviceNoVoices: "Clients van externe diensten kunnen geen stemmen uit de gebruikersbibliotheek gebruiken",
  noLibraryForGlossaries: "Deze Runtime heeft geen gebruikersbibliotheek, dus woordenlijsten kunnen niet worden gebruikt",
  noLibraryForVoices: "Deze Runtime heeft geen gebruikersbibliotheek, dus bibliotheekstemmen kunnen niet worden gebruikt",
  translationGlossary: (p: { name: string }) => `‘${p.name}’ is een vertaalwoordenlijst en kan niet worden gebruikt voor transcriptie`,
};
