import type { RcLibraryMessages } from './rc-library.ts';

export const de: RcLibraryMessages = {

  problemSeparator: "; ",
  referenceUndecodable: (p: { problems: string }) => `Die Referenzaufnahme kann nicht decodiert werden: ${p.problems}`,
  clonesNotReady: "Stimmklonen ist noch nicht bereit",
  entryHasNoFile: "Dieser Eintrag hat keine Datei",
  notCopyable: (p: { library: string }) =>
    `${p.library === "Glossare" ? "Glossare" : p.library === "Stimmen" ? "Stimmen" : "Farben"} können nicht direkt in ein Video kopiert werden: Glossare werden beim Transkribieren und Übersetzen gewählt, Stimmen bei der Sprachsynthese und Farben beim Bearbeiten von Stilen`,
  captionItemIdsStyleOnly: "captionItemIds gilt nur für Untertitelstile",
  addFromLibraryLabel: (p: { name: string }) => `Hinzufügen: „${p.name}“ aus der Bibliothek`,
  duplicateGlossaries: (p: { step: string }) => `glossaries.${p.step} enthält dasselbe Glossar mehrmals`,
  tooManyGlossaries: (p: { max: number }) => `Jeder Schritt darf höchstens verwenden: ${p.max} Glossare`,
  glossaryWrongStep: (p: { name: string; transcription: boolean; transcribeStep: boolean }) =>
    `„${p.name}“ ist ein Glossar für ${p.transcription ? "Transkription" : "Übersetzung"}-Glossar und kann nicht verwendet werden für ${p.transcribeStep ? "Transkription" : "Übersetzung"}`,
  selectionDocumentName: "Verwendete Bibliothekseinträge",
  changeSelectionLabel: "Verwendete Bibliothekseinträge ändern",
  adoptDefaultsLabel: "Standardeinträge der Bibliothek verwenden",
  noDocumentIdAfterWrite: "Nach dem Schreiben wurde keine Dokument-ID empfangen",
  speakerBoundTwice: (p: { speakerId: string }) => `Sprecher ${p.speakerId} ist zweimal zugewiesen`,
  noSuchDocument: (p: { documentId: string }) => `Das Video hat kein Dokument ${p.documentId}`,
  documentNotSpeech: (p: { documentId: string; kind: string }) =>
    `Dokument ${p.documentId} ist ${p.kind}; Sprecher gibt es nur in Transkripten (speech)`,
  speakerNotInTranscript: (p: { documentId: string; speakerId: string }) =>
    `Transkript ${p.documentId} hat keinen Sprecher ${p.speakerId}`,
  libraryVoiceNoProvider:
    "Bibliotheksstimmen werden durch den Klon beim für die Vertonung gewählten Anbieter ersetzt: providerId nicht übergeben",
  outputNotFound: "Das Ergebnis ist nicht vorhanden",
  pathNotAbsolute: "Der Dateipfad muss absolut sein",

  serviceClientNoLibraryVoice: "Clients externer Dienste können keine Stimmen aus der Bibliothek verwenden",
  clonerNotConfigured: (p: { label: string }) => `${p.label} ist nicht aktiviert oder hat keinen Schlüssel; Stimmen können daher nicht geklont werden`,
  cloneExists: (p: { name: string; label: string }) => `Stimme „${p.name}“ hat bereits einen gültigen Klon bei ${p.label}`,
  clonePurpose: (p: { name: string }) => `Stimme klonen: „${p.name}“`,
  noClone: "Diese Stimme hat keinen Klon bei diesem Anbieter",
  remoteCloneNotDeleted: (p: { label: string; reason: string }) =>
    `Der Klon bei ${p.label} wurde nicht gelöscht; der Datensatz wurde beibehalten: ${p.reason}`,
  cloneUnsupported: (p: { providerId: string }) => `${p.providerId} hat keine API zum Stimmklonen (derzeit bietet nur ElevenLabs eine an)`,
  cloneVersionGone: "Die zu klonende Stimmversion ist nicht mehr vorhanden",
  oldCloneNotDeleted: (p: { voiceId: string; label: string; reason: string }) =>
    `Der ersetzte alte Klon (${p.voiceId}) wurde nicht gelöscht bei ${p.label}: ${p.reason}`,
};
