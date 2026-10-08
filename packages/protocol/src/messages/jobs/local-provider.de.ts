import { pluralForm } from '../../i18n.ts';
import type { JobsLocalProviderMessages } from './local-provider.ts';

export const de: JobsLocalProviderMessages = {
  assetUnreadable: "Material konnte nicht gelesen werden",
  notHandled: (p: { capability: string }) => `Der lokale Anbieter führt nicht aus: ${p.capability}`,
  referenceChanged: "Die Referenzaufnahme hat sich nach dem Einreichen geändert",
  referenceUnreadable: "Referenzaufnahme konnte nicht gelesen werden",
  speechOutputWrong: (p: { file: string }) => `Das synthetisierte Ergebnis entspricht nicht ${p.file} im Bereitstellungsordner`,
  stemOutputWrong: (p: { file: string }) => `Das getrennte Ergebnis entspricht nicht ${p.file} im Bereitstellungsordner`,
  speakersOutputWrong: (p: { file: string }) => `Das Sprechererkennungsergebnis entspricht nicht ${p.file} im Bereitstellungsordner`,
  imageNoInput: "Die lokale Bilderzeugung hat keine Eingabedatei",
  imageOutputWrong: (p: { file: string }) => `Das Bildergebnis entspricht nicht ${p.file} im Bereitstellungsordner`,
  runtimeStopping: "Runtime wird heruntergefahren",
  bundleRequired: "Lokale Inferenz benötigt ein Modellpaket",
  bundleDisabled: "Das Modellpaket ist deaktiviert",
  workerBusy: "Der Worker dieses Modellpakets führt eine andere Aufgabe aus",
  workerVersionChanged: "Die Worker-Version unterscheidet sich vom ersten Versuch; es wird daher nicht automatisch erneut versucht",
  noOutput: "job.run hat completed ohne Ergebnis zurückgegeben",
  workerExitedDuringJob: "Model Worker wurde während der Aufgabe beendet",
  inferenceFailed: (p: { code: string }) => `Inferenz fehlgeschlagen: ${p.code}`,
  stagingUnwritable: "Ergebnis konnte nicht in den Bereitstellungsordner geschrieben werden; Speicherplatz prüfen",
  workerUnsupported: (p: { message: string }) => `Model Worker unterstützt diese Aufgabe nicht: ${p.message}`,
  jobRunReturned: (p: { code: string }) => `job.run hat zurückgegeben: ${p.code}`,
  workerNotFound: "Model Worker (model-worker) nicht gefunden",
  workerCannotStart: "Model Worker konnte nicht gestartet werden",
  workerExitedOnStart: "Model Worker wurde direkt nach dem Start beendet",
  handshakeFailed: "Handshake mit Model Worker fehlgeschlagen",
  contractMismatch: "Die Vertragsversion von Model Worker stimmt nicht überein",
  backendUnavailable: (p: { backend: string }) => `Dieser Model Worker kann nicht verwenden: ${p.backend}-Backend`,
  cannotSeparate: "Dieser Model Worker kann mit diesem Modell noch keine lokale Trennung von Stimme und Hintergrund ausführen",
  cannotGenerateImage: "Dieser Model Worker kann mit diesem Modell noch keine lokalen Bilder erzeugen",
  cannotDiarize: "Dieser Model Worker kann noch keine lokalen Sprecher erkennen",
  cannotTranscribe: "Dieser Model Worker kann mit diesem Modell noch nicht lokal transkribieren",
  cannotSynthesize: "Dieser Model Worker kann mit diesem Modell noch keine lokale Sprachsynthese ausführen",
  loadFailed: (p: { reason: string }) => `Laden des Modellpakets fehlgeschlagen: ${p.reason}`,
  workerExitedOnLoad: "Model Worker wurde beim Laden beendet",
  crashedRepeatedly: (p: { minutes: number; count: number }) =>
    `Abgestürzt: ${p.count} ${pluralForm('de', p.count, { one: "Mal", other: "Mal" })} in ${p.minutes} ${pluralForm('de', p.minutes, { one: "Minute", other: "Minuten" })}`,

  readingDroppedOne: (p: { at: number; reading: string; origin: string }) =>
    `Zeichen ${p.at} wurde nicht mit dieser Aussprache synthetisiert: „${p.reading}“ (${p.origin})`,
  readingDroppedRange: (p: { from: number; to: number; reading: string; origin: string }) =>
    `Zeichen ${p.from}–${p.to} wurden nicht mit dieser Aussprache synthetisiert: „${p.reading}“ (${p.origin})`,
};
