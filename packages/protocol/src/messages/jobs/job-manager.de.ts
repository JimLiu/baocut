import { pluralForm } from '../../i18n.ts';
import type { JobsManagerMessages } from './job-manager.ts';

export const de: JobsManagerMessages = {

  runtimeStopping: "Runtime wird heruntergefahren",
  jobNotFound: "Die Aufgabe ist nicht vorhanden",
  noBundle: "Kein solches Modellpaket",
  noBundleId: (p: { bundleId: string }) => `Kein solches Modellpaket: ${p.bundleId}`,
  jobIdExists: "Die Aufgaben-ID ist bereits vorhanden",
  onlyHostedRerun: "Nur verwaltete Aufgaben können so erneut ausgeführt werden",
  notEnded: "Die Aufgabe ist noch nicht abgeschlossen",
  hintTooLong: "Der Begriffshinweis darf höchstens 1200 Zeichen lang sein",
  hintIgnored: (p: { model: string }) => `${p.model} unterstützt keine Erkennungshinweise; der Hinweis wurde nicht verwendet`,
  onlyAudioVideo: "Nur Audio- oder Videomaterial kann transkribiert werden",
  pathNotAbsolute: "Pfade müssen absolut sein",
  trackInvalid: "track muss eine nichtnegative ganze Zahl sein",
  noGeneration: "Diese Runtime bietet keine Erzeugung an",
  videoNotOpen: "Das Video ist nicht geöffnet",
  contentHashInvalid: "Der Inhalts-Hash muss sha256:<hex> sein",
  timescaleInvalid: "timescale muss eine positive ganze Zahl sein",
  rangeInvalid: "range ist ungültig",
  bundleCannotTranscribe: "Dieses Modellpaket kann nicht transkribieren",
  bundleUnavailable: "Das Modellpaket ist derzeit nicht verfügbar",
  localInferenceUnavailable: "Lokale Inferenz ist nicht verfügbar",
  invalidLanguageTag: (p: { tag: string }) => `Kein gültiger BCP 47-Sprachtag: ${p.tag}`,
  cannotReadInput: "Eingabedatei konnte nicht gelesen werden",

  jobReconciling: "Diese Aufgabe wird wiederhergestellt oder abgeglichen",
  openVideoToRetry: "Das Video ist nicht geöffnet; öffnen und erneut versuchen",
  openVideoToApply: "Das Video ist nicht geöffnet; öffnen und dann anwenden",
  receiptUnknownLater: "Bestätigung der letzten Übernahme nicht gefunden; später erneut versuchen",
  receiptUnknown: "Bestätigung der letzten Übernahme nicht gefunden",
  requeueCheckFailed: "Prüfung vor erneutem Einreihen fehlgeschlagen",
  assetVersionGone: "Das Material oder seine Version ist nicht mehr im Video vorhanden",
  assetChanged: "Der Materialinhalt hat sich geändert",
  cannotRerun: "Diese Aufgabe kann nicht erneut ausgeführt werden",
  cannotOpenVideoAfterRestart: "Video konnte nach dem Neustart nicht geöffnet werden",
  videoNotOpenNoPlace: "Das Video ist nicht geöffnet und sein Speicherort ist unbekannt",
  videoFolderGone: "Der Videoordner ist nicht mehr vorhanden",
  videoReplaced: "Am ursprünglichen Speicherort befindet sich jetzt ein anderes Video",
  recoverFailed: "Wiederherstellung der Aufgabe fehlgeschlagen",
  interrupted: "Die Aufgabe wurde vor dem Stopp der Runtime nicht abgeschlossen; sie kann erneut eingereicht werden",
  needsReconciliation:
    "Ein ausgehender Aufruf hatte beim Stopp der Runtime noch keine Antwort geliefert. Es ist unbekannt, ob die Gegenstelle ihn ausgeführt oder berechnet hat. Erneut versuchen oder verwerfen (wird nicht automatisch erneut gesendet)",

  executeFailed: "Ausführung der Aufgabe fehlgeschlagen",
  providerUnavailable: "Anbieter nicht verfügbar",
  executorGone: "Der Ausführer der Aufgabe ist nicht mehr vorhanden",
  localCrashedAfterRetry: "Der lokale Inferenzprozess ist auch nach einem erneuten Versuch abgestürzt",
  transcribeFailedAfterRetry: "Transkription auch nach erneutem Versuch fehlgeschlagen",

  outputCountMismatch: (p: { actual: number; expected: number }) =>
    `Es ${pluralForm('de', p.actual, { one: "ist 1 Ergebnis", other: `sind ${p.actual} Ergebnisse` })}, angefordert wurden jedoch ${p.expected} ${pluralForm('de', p.expected, { one: "wurde", other: "wurden" })}`,
  outputNotInStaging: (p: { n: number }) => `Ergebnis ${p.n} liegt nicht im Bereitstellungsordner`,
  outputMissing: (p: { n: number }) => `Ergebnis ${p.n} ist nicht vorhanden`,
  outputLengthMismatch: (p: { n: number; actual: number; declared: number }) =>
    `Ergebnis ${p.n} ist ${p.actual} Bytes; deklariert wurden jedoch ${p.declared}`,
  outputShaMismatch: (p: { n: number }) => `Ergebnis ${p.n} hat einen anderen sha256 als deklariert`,
  outputTypeMismatch: (p: { n: number; actual: string; expected: string }) =>
    `Ergebnis ${p.n} ist ${p.actual}, angefordert wurden jedoch ${p.expected} wurde angefordert`,
  outputProblem: (p: { n: number; problem: string }) => `Ergebnis ${p.n}: ${p.problem}`,
  noTextResult: "Der Ausführer hat kein Textergebnis zurückgegeben",
  textOutputCount: (p: { actual: number }) => `Es gibt ${p.actual} Ergebnisse; erwartet wird 1`,
  textNotInStaging: "Das Ergebnis liegt nicht im Bereitstellungsordner",
  textMissing: "Das Ergebnis ist nicht vorhanden",
  textLengthMismatch: (p: { actual: number; declared: number }) => `Das Ergebnis hat ${p.actual} Bytes; deklariert wurden jedoch ${p.declared}`,
  textShaMismatch: "Der sha256 des Ergebnisses stimmt nicht mit dem deklarierten Wert überein",
  textTypeMismatch: (p: { actual: string; expected: string }) => `Das Ergebnis hat ${p.actual}, angefordert wurden jedoch ${p.expected} wurde angefordert`,
  notUtf8: "Das Ergebnis ist kein gültiges UTF-8",
  notJson: "Das Ergebnis ist kein gültiges JSON",
  emptyOutput: "Das Ergebnis ist leer",
  generatedInvalid: "Das erzeugte Ergebnis hat die Decodierungsprüfung nicht bestanden",

  asrFileNotInStaging: "Die Ergebnisdatei liegt nicht im Bereitstellungsordner",
  asrFileMissing: "Die Ergebnisdatei ist nicht vorhanden",
  asrLengthMismatch: (p: { actual: number; declared: number }) => `Das Ergebnis hat ${p.actual} Bytes; die Antwort meldete jedoch ${p.declared}`,
  asrShaMismatch: "Der sha256 des Ergebnisses stimmt nicht mit der Antwort überein",
  asrContractInvalid: "Das Modellergebnis erfüllt baocut.asr-result/v1 nicht",

  outputTruncated: (p: { limit: number }) => `Das Ergebnis hat das Limit erreicht (${p.limit} Token) und wurde abgeschnitten; der Inhalt ist unvollständig`,
  saveCopyFailed: (p: { dir: string; reason: string }) => `Kopie konnte nicht geschrieben werden nach ${p.dir}: ${p.reason}`,

  applyError: "Schreiben ins Video fehlgeschlagen",
  transcribeLabel: "Transkribieren",
  voiceOverLabel: "Vertonung erzeugen",
  imageLabel: "Bild erzeugen",
  videoClosed: "Das Video wurde geschlossen",
  assetGone: "Das Material ist nicht mehr im Video vorhanden",
  assetChangedDuringTranscribe: "Der Materialinhalt hat sich während der Transkription geändert",
  generatedGone: "Das erzeugte Ergebnis ist nicht mehr vorhanden",
  asrGone: "Das Transkriptionsergebnis ist nicht mehr vorhanden",
  asrNotJson: "Das Transkriptionsergebnis ist kein gültiges JSON",
  asrInvalid: "Das Transkriptionsergebnis entspricht nicht dem Vertrag",
  targetGone: "Das Ziel ist nicht mehr vorhanden",
  staleGeneratedKept: (p: { reason: string }) => `${p.reason}; das erzeugte Ergebnis wurde beibehalten`,
  protectedKept: (p: { generated: boolean }) =>
    `${p.generated ? "Erzeugung" : "Transkription"} abgeschlossen, aber das Ergebnis berührt den unveränderlichen Bereich im Aufgabenvertrag und wurde daher nicht ins Video geschrieben. Das Ergebnis wurde beibehalten; der Benutzer entscheidet über die Anwendung`,
  applyFailedKept: (p: { generated: boolean }): string =>
    p.generated
      ? "Erzeugung abgeschlossen, aber der Import ins Video ist fehlgeschlagen; das Ergebnis wurde beibehalten"
      : "Transkription abgeschlossen, aber Schreiben ins Video fehlgeschlagen; das Ergebnis wurde beibehalten",
};
