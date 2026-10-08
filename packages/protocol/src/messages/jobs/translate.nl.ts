import type { JobsTranslateMessages } from './translate.ts';

export const nl: JobsTranslateMessages = {
  label: "Vertalen",
  description:
    "Vertaalt een transcript in de video zin voor zin naar een andere taal en schrijft het resultaat als nieuw vertaaldocument. Een tekstmodel doet het werk; er wordt geen agent gestart.",
  stepFreezeSource: "Bron lezen",
  stepTranslate: "Vertalen",
  stepAssemble: "Vertaling samenstellen",
  stepWrite: "Naar video schrijven",
  videoNotOpen: "De video is niet geopend",
  noStructuredOutput: (p: { model: string }) => `Model ${p.model} ondersteunt geen gestructureerde uitvoer, dus kan niet worden gebruikt voor vertaling`,
  workerMismatch: "De vertaling van de Speech Worker komt niet overeen met de bevroren bron",
  targetLanguageInvalid: "Parameter targetLanguage moet een BCP 47-taaltag zijn",
  flagInvalid: (p: { key: string }) => `Parameter ${p.key} moet true of false zijn`,
  bilingualNeedsCaptions: "Parameter bilingual mag alleen worden opgegeven als captions true is (een ondertitellaag toevoegen)",
  noDocument: (p: { documentId: string }) => `De video heeft geen document ${p.documentId}`,
  notSpeech: (p: { documentId: string; kind: string }) =>
    `Document ${p.documentId} is ${p.kind}; alleen transcripten (speech) kunnen worden vertaald`,
  noTranscript: "De video heeft geen transcript. Transcribeer het vóór het vertalen.",
  multipleTranscripts: "De video heeft meer dan één transcript. Gebruik documentId om te kiezen welke je wilt vertalen.",
  videoClosed: "De video is gesloten",
  sourceGone: "Het brondocument staat niet meer in de video",
  noSentences: "Het transcript heeft geen zinnen om te vertalen",
  sameLanguage: (p: { source: string; target: string }) =>
    `De transcripttaal ${p.source} is gelijk aan de doeltaal ${p.target}, dus er is geen vertaling nodig`,
  workerMissing: "Kan de Speech Worker (speech-worker) niet vinden. Voer eerst npm run build:engine uit.",

  documentName: (p: { language: string }) => `Vertaling ${p.language}`,
  videoClosedKept: "De video is gesloten. De vertaling blijft behouden in de uitvoer.",
  sourceChanged:
    "Het brondocument is gewijzigd tijdens het vertalen, dus er is niets naar de video geschreven. Opnieuw proberen vertaalt de huidige versie van het brondocument.",

  transactionLabel: (p: { language: string }) => `Vertalen naar ${p.language}`,
  noDocumentId: "De vertaling is naar de video geschreven, maar de document-ID is niet geretourneerd",
  rejected: "De transactie om naar de video te schrijven is geweigerd. De vertaling blijft behouden in de uitvoer.",
};
