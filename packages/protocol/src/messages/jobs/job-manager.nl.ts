import { pluralForm } from '../../i18n.ts';
import type { JobsManagerMessages } from './job-manager.ts';

export const nl: JobsManagerMessages = {

  runtimeStopping: "Runtime wordt afgesloten",
  jobNotFound: "De taak bestaat niet",
  noBundle: "Dit modelpakket bestaat niet",
  noBundleId: (p: { bundleId: string }) => `Dit modelpakket bestaat niet: ${p.bundleId}`,
  jobIdExists: "De taak-ID bestaat al",
  onlyHostedRerun: "Alleen beheerde taken kunnen op deze manier opnieuw worden uitgevoerd",
  notEnded: "De taak is nog niet voltooid",
  hintTooLong: "De termhint mag niet langer zijn dan 1200 tekens",
  onlyAudioVideo: "Alleen audio- of videomedia kunnen worden getranscribeerd",
  pathNotAbsolute: "Paden moeten absoluut zijn",
  trackInvalid: "spoor moet een niet-negatief geheel getal zijn",
  noGeneration: "Deze Runtime biedt geen generatie",
  videoNotOpen: "De video is niet geopend",
  contentHashInvalid: "De inhoudshash moet sha256:<hex> zijn",
  timescaleInvalid: "timescale moet een positief geheel getal zijn",
  rangeInvalid: "range is ongeldig",
  bundleCannotTranscribe: "Dit modelpakket kan niet transcriberen",
  bundleUnavailable: "Het modelpakket is nu niet beschikbaar",
  localInferenceUnavailable: "Lokale inferentie is niet beschikbaar",
  invalidLanguageTag: (p: { tag: string }) => `Geen geldige BCP 47-taaltag: ${p.tag}`,
  cannotReadInput: "Kan het invoerbestand niet lezen",

  jobReconciling: "Deze taak wordt hersteld of afgestemd",
  openVideoToRetry: "De video is niet geopend; open die en probeer het opnieuw",
  openVideoToApply: "De video is niet geopend; open die en pas het toe",
  receiptUnknownLater: "Kan de bevestiging van de laatste vastlegging niet vinden; probeer het later opnieuw",
  receiptUnknown: "Kan de bevestiging van de laatste vastlegging niet vinden",
  requeueCheckFailed: "De controle voor opnieuw in de wachtrij plaatsen is mislukt",
  assetVersionGone: "Het mediabestand of de versie ervan staat niet meer in de video",
  assetChanged: "De media-inhoud is gewijzigd",
  cannotRerun: "Deze taak kan niet opnieuw worden uitgevoerd",
  cannotOpenVideoAfterRestart: "Kan de video niet openen na het opnieuw starten",
  videoNotOpenNoPlace: "De video is niet geopend en de locatie is onbekend",
  videoFolderGone: "De videomap bestaat niet meer",
  videoReplaced: "Er staat nu een andere video op de oorspronkelijke locatie",
  recoverFailed: "Het herstellen van de taak is mislukt",
  interrupted: "De taak was niet klaar voordat de Runtime stopte; je kunt die opnieuw indienen",
  needsReconciliation:
    "Een uitgaande aanroep had nog niet geantwoord toen de Runtime stopte, dus het is onbekend of de andere kant die heeft uitgevoerd of kosten in rekening heeft gebracht. Kies opnieuw proberen of weggooien (de aanroep wordt niet automatisch opnieuw verzonden)",

  executeFailed: "Het uitvoeren van de taak is mislukt",
  providerUnavailable: "Aanbieder niet beschikbaar",
  executorGone: "De uitvoerder van de taak is verdwenen",
  localCrashedAfterRetry: "Het lokale inferentieproces is ook na een nieuwe poging gecrasht",
  transcribeFailedAfterRetry: "Transcriptie is ook na een nieuwe poging mislukt",

  outputCountMismatch: (p: { actual: number; expected: number }) =>
    `Er ${pluralForm('nl', p.actual, { one: "is 1 uitvoeritem", other: `zijn ${p.actual} uitvoeritems` })}, maar aangevraagd: ${p.expected} ${pluralForm('nl', p.expected, { one: "is", other: "zijn" })}`,
  outputNotInStaging: (p: { n: number }) => `Uitvoer ${p.n} staat niet in de tijdelijke uitvoermap`,
  outputMissing: (p: { n: number }) => `Uitvoer ${p.n} bestaat niet`,
  outputLengthMismatch: (p: { n: number; actual: number; declared: number }) =>
    `Uitvoer ${p.n} is ${p.actual} bytes, maar opgegeven: ${p.declared}`,
  outputShaMismatch: (p: { n: number }) => `Uitvoer ${p.n} heeft een andere sha256 dan opgegeven`,
  outputTypeMismatch: (p: { n: number; actual: string; expected: string }) =>
    `Uitvoer ${p.n} is ${p.actual}, maar aangevraagd: ${p.expected} is aangevraagd`,
  outputProblem: (p: { n: number; problem: string }) => `Uitvoer ${p.n}: ${p.problem}`,
  noTextResult: "De uitvoerder heeft geen tekstresultaat geretourneerd",
  textOutputCount: (p: { actual: number }) => `Er zijn ${p.actual} uitvoeritems; er moet er 1 zijn`,
  textNotInStaging: "De uitvoer staat niet in de tijdelijke uitvoermap",
  textMissing: "De uitvoer bestaat niet",
  textLengthMismatch: (p: { actual: number; declared: number }) => `De uitvoer heeft ${p.actual} bytes, maar opgegeven: ${p.declared}`,
  textShaMismatch: "De sha256 van de uitvoer komt niet overeen met de opgegeven waarde",
  textTypeMismatch: (p: { actual: string; expected: string }) => `De uitvoer heeft ${p.actual}, maar aangevraagd: ${p.expected} is aangevraagd`,
  notUtf8: "De uitvoer is geen geldige UTF-8",
  notJson: "De uitvoer is geen geldige JSON",
  emptyOutput: "De uitvoer is leeg",
  generatedInvalid: "De gegenereerde uitvoer heeft de decodeercontrole niet doorstaan",

  asrFileNotInStaging: "Het uitvoerbestand staat niet in de tijdelijke uitvoermap",
  asrFileMissing: "Het uitvoerbestand bestaat niet",
  asrLengthMismatch: (p: { actual: number; declared: number }) => `De uitvoer heeft ${p.actual} bytes, maar het antwoord vermeldde ${p.declared}`,
  asrShaMismatch: "De sha256 van de uitvoer komt niet overeen met het antwoord",
  asrContractInvalid: "De modeluitvoer voldoet niet aan baocut.asr-result/v1",

  outputTruncated: (p: { limit: number }) => `De uitvoer heeft de limiet bereikt (${p.limit} tokens) en is afgekapt; de inhoud is onvolledig`,
  saveCopyFailed: (p: { dir: string; reason: string }) => `Kan geen kopie schrijven naar ${p.dir}: ${p.reason}`,

  applyError: "Schrijven naar de video is mislukt",
  transcribeLabel: "Transcriberen",
  voiceOverLabel: "Nasynchronisatie genereren",
  imageLabel: "Afbeelding genereren",
  videoClosed: "De video is gesloten",
  assetGone: "Het mediabestand staat niet meer in de video",
  assetChangedDuringTranscribe: "De media-inhoud is gewijzigd tijdens de transcriptie",
  generatedGone: "De gegenereerde uitvoer bestaat niet meer",
  asrGone: "De uitvoer van de transcriptie bestaat niet meer",
  asrNotJson: "De uitvoer van het transcript is geen geldige JSON",
  asrInvalid: "De uitvoer van de transcriptie voldoet niet aan het contract",
  targetGone: "Het doel bestaat niet meer",
  staleGeneratedKept: (p: { reason: string }) => `${p.reason}; het gegenereerde resultaat is behouden`,
  protectedKept: (p: { generated: boolean }) =>
    `${p.generated ? "Generatie" : "Transcriptie"} voltooid, maar het resultaat raakt het bereik ‘niet wijzigen’ in het taakcontract, dus het is niet naar de video geschreven. Het resultaat is behouden; de gebruiker bepaalt of het wordt toegepast`,
  applyFailedKept: (p: { generated: boolean }): string =>
    p.generated
      ? "Generatie voltooid, maar importeren in de video is mislukt; het resultaat is behouden"
      : "Transcriptie voltooid, maar schrijven naar de video is mislukt; het resultaat is behouden",
};
