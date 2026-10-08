import { pluralForm } from '../../i18n.ts';
import type { JobsLocalProviderMessages } from './local-provider.ts';

export const nl: JobsLocalProviderMessages = {
  assetUnreadable: "Kan het mediabestand niet lezen",
  notHandled: (p: { capability: string }) => `De lokale aanbieder voert niet uit: ${p.capability}`,
  referenceChanged: "De referentieopname is gewijzigd nadat die is ingediend",
  referenceUnreadable: "Kan de referentieopname niet lezen",
  speechOutputWrong: (p: { file: string }) => `De gesynthetiseerde uitvoer is niet ${p.file} in de tijdelijke uitvoermap`,
  stemOutputWrong: (p: { file: string }) => `De gescheiden uitvoer is niet ${p.file} in de tijdelijke uitvoermap`,
  speakersOutputWrong: (p: { file: string }) => `De uitvoer van sprekeridentificatie is niet ${p.file} in de tijdelijke uitvoermap`,
  imageNoInput: "Lokale afbeeldingsgeneratie heeft geen invoerbestand",
  imageOutputWrong: (p: { file: string }) => `De afbeeldingsuitvoer is niet ${p.file} in de tijdelijke uitvoermap`,
  runtimeStopping: "Runtime wordt afgesloten",
  bundleRequired: "Lokale inferentie vereist een modelpakket",
  bundleDisabled: "Het modelpakket is uitgeschakeld",
  workerBusy: "De Worker van dit modelpakket voert een andere taak uit",
  workerVersionChanged: "De Worker-versie verschilt van de eerste poging, dus er wordt niet automatisch opnieuw geprobeerd",
  noOutput: "job.run heeft completed geretourneerd zonder uitvoer",
  workerExitedDuringJob: "Model Worker is afgesloten tijdens de taak",
  inferenceFailed: (p: { code: string }) => `Inferentie mislukt: ${p.code}`,
  stagingUnwritable: "Kan de uitvoer niet naar de tijdelijke uitvoermap schrijven; controleer de schijfruimte",
  workerUnsupported: (p: { message: string }) => `Model Worker ondersteunt deze taak niet: ${p.message}`,
  jobRunReturned: (p: { code: string }) => `job.run heeft geretourneerd: ${p.code}`,
  workerNotFound: "Model Worker (model-worker) niet gevonden",
  workerCannotStart: "Kan Model Worker niet starten",
  workerExitedOnStart: "Model Worker is direct na het starten afgesloten",
  handshakeFailed: "Handshake met Model Worker mislukt",
  contractMismatch: "De contractversie van Model Worker komt niet overeen",
  backendUnavailable: (p: { backend: string }) => `Deze Model Worker kan niet gebruiken: ${p.backend}-backend`,
  cannotSeparate: "Deze Model Worker kan nog geen lokale scheiding van stemmen en achtergrond uitvoeren met dit model",
  cannotGenerateImage: "Deze Model Worker kan nog geen lokale afbeeldingen genereren met dit model",
  cannotDiarize: "Deze Model Worker kan nog geen lokale sprekers identificeren",
  cannotTranscribe: "Deze Model Worker kan nog niet lokaal transcriberen met dit model",
  cannotSynthesize: "Deze Model Worker kan nog geen lokale spraaksynthese uitvoeren met dit model",
  loadFailed: (p: { reason: string }) => `Het laden van het modelpakket is mislukt: ${p.reason}`,
  workerExitedOnLoad: "Model Worker is tijdens het laden afgesloten",
  crashedRepeatedly: (p: { minutes: number; count: number }) =>
    `Gecrasht: ${p.count} ${pluralForm('nl', p.count, { one: "keer", other: "keer" })} in ${p.minutes} ${pluralForm('nl', p.minutes, { one: "minuut", other: "minuten" })}`,

  readingDroppedOne: (p: { at: number; reading: string; origin: string }) =>
    `Teken ${p.at} is niet gesynthetiseerd met de uitspraak ‘${p.reading}’ (${p.origin})`,
  readingDroppedRange: (p: { from: number; to: number; reading: string; origin: string }) =>
    `Tekens ${p.from}–${p.to} zijn niet gesynthetiseerd met de uitspraak ‘${p.reading}’ (${p.origin})`,
};
