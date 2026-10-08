import { pluralForm } from '../../i18n.ts';
import type { RcModelsMessages } from './rc-models.ts';

export const nl: RcModelsMessages = {

  offlineStrict: "Modellen worden niet gedownload in de strikte offlinemodus",
  sizeChanged: "Het aantal bytes om te downloaden is gewijzigd. Bevestig opnieuw met het nieuwe plan",
  bundleInUse: "Het modelpakket is in gebruik. Verwijder het nadat de taken klaar of geannuleerd zijn",
  diarizationNoCheck:
    "Het modelpakket voor het scheiden van sprekers heeft geen eigen controle: het wordt samen met het herkenningsmodelpakket gebruikt bij het transcriberen",
  bundleUnavailable: "Het modelpakket is nu niet beschikbaar",
  installFailed: "Er is iets misgegaan bij het installeren van het model",
  noSuchBundle: (p: { bundleId: string }) => `Geen modelpakket: ${p.bundleId}`,
  movingDirWait: "De modellenmap wordt verplaatst. Probeer het opnieuw wanneer dat klaar is",
  dirMissing:
    "De modellenmap bestaat niet (dit gebeurt ook als een externe schijf niet is verbonden). Verbind die en probeer het opnieuw of kies een andere modellenmap bij Instellingen",
  selfTestSampleLabel: "het herkenningsvoorbeeld",

  workerFailed: (p: { reason: string }) => `Worker mislukt: ${p.reason}`,
  workerCancelledCheck: "De Worker heeft de controle zelf geannuleerd",
  noWorkerOutput: "De Worker heeft geen uitvoer gemaakt",
  outputMissing: "Het uitvoerbestand bestaat niet",
  outputMismatch: "De lengte of sha256 van het uitvoerbestand komt niet overeen met het antwoord van de Worker",
  namedOutputMissing: (p: { file: string }) => `Het uitvoerbestand ${p.file} bestaat niet`,
  namedOutputMismatch: (p: { file: string }) => `De lengte of sha256 van ${p.file} komt niet overeen met het antwoord van de Worker`,
  outputNotJson: "De uitvoer is geen geldige JSON",
  outputNotAsrResult: "De uitvoer voldoet niet aan het asr-result-contract",
  transcriptMissingExpected: (p: { expected: string }) => `De herkende tekst bevat niet ‘${p.expected}’`,
  separationPassed: (p: { duration: string; sampleRate: number; ratio: string; finite: boolean }) =>
    `${p.duration} s · ${p.sampleRate} Hz · stem ${p.finite ? `${p.ratio} dB` : "veel"} boven de achtergrond`,
  speechPassed: (p: { duration: string; sampleRate: number }) => `${p.duration} s · ${p.sampleRate} Hz`,
  imagePassed: (p: { width: number; height: number; steps: number }) => `${p.width}×${p.height} · ${p.steps} stappen`,

  envLocked: "De modellenmap is ingesteld door de omgevingsvariabele BAOCUT_MODELS_DIR. Wijzig de variabele en start BaoCut opnieuw om de map te wijzigen",
  movingDirWaitOrCancel: "De modellenmap wordt verplaatst. Wijzig die nadat het verplaatsen klaar of geannuleerd is",
  folderMissing: "Deze map bestaat niet (dit gebeurt ook als een externe schijf niet is verbonden)",
  folderNotWritable: "BaoCut heeft geen toestemming om naar deze map te schrijven",
  dirNested: "De nieuwe locatie en de huidige modellenmap bevatten elkaar. Kies een map die er niet in staat en die de map niet bevat",
  noSpaceForMove: "De schijf op de nieuwe locatie heeft onvoldoende ruimte om de modellen te verplaatsen",
  noSpaceRemedy: "Maak ruimte vrij, kies een andere locatie of kies ‘Alleen de locatie wijzigen’",
  dirInUse: "Taken gebruiken lokale modellen. Wijzig de modellenmap nadat die klaar of geannuleerd zijn",
  sourceKept: (p: { count: number }) =>
    `${p.count} ${pluralForm('nl', p.count, { one: "repository", other: "repository’s" })} in de oude map kunnen niet worden verwijderd. Je kunt ze handmatig verwijderen`,
  moveNoSpace: "De schijf op de nieuwe locatie is vol geraakt. Het verplaatsen is teruggedraaid",
  moveFailed: "Er is iets misgegaan bij het verplaatsen van de modellen. Het verplaatsen is teruggedraaid",
  moveFailedRemedy: "De oorspronkelijke modellenmap is ongewijzigd en de modellen werken nog steeds",

  noAlignableFormat: (p: { modelId: string }) => `Model ${p.modelId} geeft geen audioformaat uit dat kan worden uitgelijnd`,
  synthOutputCount: (p: { count: number }) => `Spraaksynthese heeft gemaakt: ${p.count} uitvoeritems; er moet er 1 zijn`,
  synthOutputOutsideStaging: "De spraaksynthese-uitvoer staat niet in de tijdelijke uitvoermap",
  dubGrantHint: (p: { recipient: string }) =>
    `Nasynchronisatie stuurt het transcript (de vertaling en het origineel waar een vertaling ontbreekt) naar ${p.recipient}. De standaardtoestemming die wordt gemaakt bij het inschakelen van een aanbieder bevat geen transcripten, dus de gebruiker moet expliciet toestemming geven (met de onderstaande opdracht of bij Instellingen van BaoCut) en daarna deze nasynchronisatie opnieuw uitvoeren.`,
  voiceRemoved: (p: { reason: string; voice: string }) => `${p.reason}: stem ${p.voice}`,

  notSpeakersJob: "Deze taak is geen sprekerherkenning",
  jobNotForVideo: "Deze herkenning hoort niet bij deze video",
  speakersNotDone: "De sprekerherkenning is nog niet voltooid",
  speakersCleaned: "De herkenningsresultaten zijn opgeruimd. Herken de sprekers opnieuw",

  recoveryPrincipalName: "Taakherstel",
};
