import type { VoicesLibraryMessages } from './voices-library-copy.ts';

export const nl: VoicesLibraryMessages = {

  consentStatement: "Dit is mijn eigen stem of ik heb toestemming van de spreker",
  uploading: (label: string) => `Uploaden naar ${label}…`,
  noConsent: "Niet gemarkeerd als je eigen stem of gebruikt met toestemming, dus wordt niet naar derden geüpload. Vink eerst de verklaring aan bij ‘Bewerken’.",
  cannotClone: (label: string) => `Deze Runtime kan niet klonen bij ${label}`,
  providerOff: (label: string, detail: string | null) =>
    `${label} kan nu niet worden gebruikt${detail ? ` (${detail})` : ""}: schakel het eerst in en stel de sleutel in bij ‘Cloudmodellen’`,
  consentUnstated: "Toestemming niet aangegeven",
  cloned: (label: string) => `Gekloond bij ${label}`,
  cloneStale: (label: string) => `${label}: kloon verouderd`,
  languageUnknown: "Taal niet aangegeven",
  recorded: "Opgenomen in de app",
  imported: "Geïmporteerd uit een bestand",
  edited: (ago: string) => `Bewerkt: ${ago}`,
  nameRequired: "Geef de stem een naam",
  nameTooLong: (max: number) => `Namen mogen maximaal ${max} tekens lang zijn`,
  transcriptTooLong: (max: number) => `Transcripten mogen maximaal ${max} tekens lang zijn`,
  dontKnow: "Niet zeker",
  deleteClones: (labels: readonly string[]) => `De klonen bij ${labels.join(", ")} worden eerst verwijderd; als dat mislukt, blijft de stem behouden.`,
  deleteBody: (clones: string) => `Video’s die deze stem gebruiken vallen de volgende keer dat ze genereren terug op de standaardstem; bestaande nasynchronisaties blijven ongewijzigd. ${clones}`.trim(),
  uploadNotice: (name: string, size: string | null, label: string) =>
    `De referentieopname van ‘${name}’${size ? ` (${size})` : ""} wordt geüpload naar ${label} om een kloon te maken. Daarna gebruikt deze stem bij ${label} rechtstreeks de stem-ID van de aanbieder; bij het verwijderen van de stem wordt deze kloon eerst verwijderd.`,

  withRemedy: (message: string, remedy: string) => `${message.replace(/[。.]$/, "")}. ${remedy}`,
  remedyConsent: "Stemmen zonder toestemmingsverklaring worden niet naar derden geüpload: vink eerst de verklaring aan bij ‘Bewerken’.",
  remedyConfigure: "Schakel deze aanbieder in en stel de sleutel in bij ‘Cloudmodellen’.",
  remedyConflict: "Deze stem is zojuist elders gewijzigd. De nieuwste versie staat hieronder; bekijk die voordat je opslaat.",
  remedyGrant: "De referentieopname naar een aanbieder sturen vereist toestemming voor uitgaand verkeer: geef die bij Instellingen en probeer het opnieuw.",
};
