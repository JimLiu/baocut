import type { VoicesLibraryMessages } from './voices-library-copy.ts';

export const de: VoicesLibraryMessages = {

  consentStatement: "Dies ist meine eigene Stimme oder ich habe die Erlaubnis des Sprechers",
  uploading: (label: string) => `Wird hochgeladen an ${label}…`,
  noConsent: "Nicht als eigene Stimme oder Nutzung mit Erlaubnis gekennzeichnet; wird daher nicht an Dritte hochgeladen. Zuerst die Erklärung unter „Bearbeiten“ bestätigen.",
  cannotClone: (label: string) => `Diese Runtime kann nicht klonen bei ${label}`,
  providerOff: (label: string, detail: string | null) =>
    `${label} kann derzeit nicht verwendet werden${detail ? ` (${detail})` : ""}: zuerst unter „Cloud-Modelle“ aktivieren und den Schlüssel festlegen`,
  consentUnstated: "Einwilligung nicht angegeben",
  cloned: (label: string) => `Geklont bei ${label}`,
  cloneStale: (label: string) => `${label}: Klon veraltet`,
  languageUnknown: "Sprache nicht angegeben",
  recorded: "In der App aufgenommen",
  imported: "Aus einer Datei importiert",
  edited: (ago: string) => `Bearbeitet: ${ago}`,
  nameRequired: "Der Stimme einen Namen geben",
  nameTooLong: (max: number) => `Namen dürfen höchstens ${max} Zeichen lang sein`,
  transcriptTooLong: (max: number) => `Transkripte dürfen höchstens ${max} Zeichen lang sein`,
  dontKnow: "Unbekannt",
  deleteClones: (labels: readonly string[]) => `Ihre Klone bei ${labels.join(", ")} werden zuerst gelöscht; bei einem Fehler bleibt die Stimme erhalten.`,
  deleteBody: (clones: string) => `Videos, die diese Stimme verwenden, greifen beim nächsten Erzeugen auf die Standardstimme zurück; bereits erzeugte Vertonungen bleiben unverändert. ${clones}`.trim(),
  uploadNotice: (name: string, size: string | null, label: string) =>
    `Die Referenzaufnahme von „${name}“${size ? ` (${size})` : ""} wird hochgeladen an ${label}, um einen Klon zu erstellen. Anschließend wird bei dieser Stimme auf ${label} direkt die Stimmen-ID des Anbieters verwendet; beim Löschen der Stimme wird dieser Klon zuerst gelöscht.`,

  withRemedy: (message: string, remedy: string) => `${message.replace(/[。.]$/, "")}. ${remedy}`,
  remedyConsent: "Stimmen ohne Einwilligungserklärung werden nicht an Dritte hochgeladen: zuerst die Erklärung unter „Bearbeiten“ bestätigen.",
  remedyConfigure: "Diesen Anbieter unter „Cloud-Modelle“ aktivieren und seinen Schlüssel festlegen.",
  remedyConflict: "Diese Stimme wurde gerade an anderer Stelle geändert. Unten steht die aktuelle Version; vor dem Speichern prüfen.",
  remedyGrant: "Das Senden der Referenzaufnahme an einen Anbieter benötigt eine Berechtigung zur Datenübertragung: in den Einstellungen erteilen und erneut versuchen.",
};
