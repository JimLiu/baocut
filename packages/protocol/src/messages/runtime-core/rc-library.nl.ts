import type { RcLibraryMessages } from './rc-library.ts';

export const nl: RcLibraryMessages = {

  problemSeparator: "; ",
  referenceUndecodable: (p: { problems: string }) => `De referentieopname kan niet worden gedecodeerd: ${p.problems}`,
  clonesNotReady: "Stemklonen is nog niet gereed",
  entryHasNoFile: "Dit item heeft geen bestand",
  notCopyable: (p: { library: string }) =>
    `${p.library === "glossaries" ? "Woordenlijsten" : p.library === "voices" ? "Stemmen" : "Kleuren"} kunnen niet rechtstreeks naar een video worden gekopieerd: woordenlijsten worden gekozen bij transcriberen en vertalen, stemmen bij spraaksynthese en kleuren bij het bewerken van stijlen`,
  captionItemIdsStyleOnly: "captionItemIds geldt alleen voor ondertitelstijlen",
  addFromLibraryLabel: (p: { name: string }) => `Toevoegen: ‘${p.name}’ uit de bibliotheek`,
  duplicateGlossaries: (p: { step: string }) => `glossaries.${p.step} bevat dezelfde woordenlijst meer dan één keer`,
  tooManyGlossaries: (p: { max: number }) => `Elke stap mag maximaal gebruiken: ${p.max} woordenlijsten`,
  glossaryWrongStep: (p: { name: string; transcription: boolean; transcribeStep: boolean }) =>
    `‘${p.name}’ is een woordenlijst voor ${p.transcription ? "transcriptie" : "vertaling"}-woordenlijst en kan niet worden gebruikt voor ${p.transcribeStep ? "transcriptie" : "vertaling"}`,
  selectionDocumentName: "Bibliotheekitems in gebruik",
  changeSelectionLabel: "Bibliotheekitems in gebruik wijzigen",
  adoptDefaultsLabel: "Standaarditems van de bibliotheek gebruiken",
  noDocumentIdAfterWrite: "Geen document-ID ontvangen na het schrijven",
  speakerBoundTwice: (p: { speakerId: string }) => `Spreker ${p.speakerId} is twee keer toegewezen`,
  noSuchDocument: (p: { documentId: string }) => `De video heeft geen document ${p.documentId}`,
  documentNotSpeech: (p: { documentId: string; kind: string }) =>
    `Document ${p.documentId} is ${p.kind}; sprekers bestaan alleen in transcripten (speech)`,
  speakerNotInTranscript: (p: { documentId: string; speakerId: string }) =>
    `Transcript ${p.documentId} heeft geen spreker ${p.speakerId}`,
  libraryVoiceNoProvider:
    "Bibliotheekstemmen worden vervangen door de kloon bij de aanbieder die voor nasynchronisatie is gekozen: geef geen providerId mee",
  outputNotFound: "De uitvoer bestaat niet",
  pathNotAbsolute: "Het bestandspad moet absoluut zijn",

  serviceClientNoLibraryVoice: "Clients van externe diensten kunnen geen stemmen uit de bibliotheek gebruiken",
  clonerNotConfigured: (p: { label: string }) => `${p.label} is niet ingeschakeld of heeft geen sleutel, dus stemmen kunnen niet worden gekloond`,
  cloneExists: (p: { name: string; label: string }) => `Stem ‘${p.name}’ heeft al een geldige kloon bij ${p.label}`,
  clonePurpose: (p: { name: string }) => `Stem klonen: ‘${p.name}’`,
  noClone: "Deze stem heeft geen kloon bij deze aanbieder",
  remoteCloneNotDeleted: (p: { label: string; reason: string }) =>
    `De kloon bij ${p.label} is niet verwijderd, dus de registratie is behouden: ${p.reason}`,
  cloneUnsupported: (p: { providerId: string }) => `${p.providerId} heeft geen API voor stemklonen (alleen ElevenLabs biedt die momenteel)`,
  cloneVersionGone: "De stemversie om te klonen bestaat niet meer",
  oldCloneNotDeleted: (p: { voiceId: string; label: string; reason: string }) =>
    `De vervangen oude kloon (${p.voiceId}) is niet verwijderd bij ${p.label}: ${p.reason}`,
};
