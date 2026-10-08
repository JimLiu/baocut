import { pluralForm } from '../../i18n.ts';
import type { RcModelsMessages } from './rc-models.ts';

export const de: RcModelsMessages = {

  offlineStrict: "Im strikten Offlinemodus werden keine Modelle heruntergeladen",
  sizeChanged: "Die Anzahl der herunterzuladenden Bytes hat sich geändert. Den neuen Plan erneut bestätigen",
  bundleInUse: "Das Modellpaket wird verwendet. Nach Abschluss oder Abbruch der Aufgaben löschen",
  diarizationNoCheck:
    "Das Modellpaket zur Sprechertrennung hat keine eigene Prüfung: Es wird bei der Transkription zusammen mit dem Erkennungsmodellpaket verwendet",
  bundleUnavailable: "Das Modellpaket ist derzeit nicht verfügbar",
  installFailed: "Bei der Modellinstallation ist ein Fehler aufgetreten",
  noSuchBundle: (p: { bundleId: string }) => `Kein Modellpaket: ${p.bundleId}`,
  movingDirWait: "Der Modellordner wird verschoben. Nach Abschluss erneut versuchen",
  dirMissing:
    "Der Modellordner ist nicht vorhanden (auch bei nicht angeschlossenem externem Laufwerk). Verbinden und erneut versuchen oder in den Einstellungen einen anderen Modellordner wählen",
  selfTestSampleLabel: "die Erkennungsprobe",

  workerFailed: (p: { reason: string }) => `Worker fehlgeschlagen: ${p.reason}`,
  workerCancelledCheck: "Der Worker hat die Prüfung selbst abgebrochen",
  noWorkerOutput: "Der Worker hat kein Ergebnis erzeugt",
  outputMissing: "Die Ergebnisdatei ist nicht vorhanden",
  outputMismatch: "Länge oder sha256 der Ergebnisdatei stimmt nicht mit der Worker-Antwort überein",
  namedOutputMissing: (p: { file: string }) => `Die Ergebnisdatei ${p.file} ist nicht vorhanden`,
  namedOutputMismatch: (p: { file: string }) => `Die Länge oder der sha256 von ${p.file} stimmt nicht mit der Worker-Antwort überein`,
  outputNotJson: "Das Ergebnis ist kein gültiges JSON",
  outputNotAsrResult: "Das Ergebnis erfüllt den asr-result-Vertrag nicht",
  transcriptMissingExpected: (p: { expected: string }) => `Der erkannte Text enthält nicht „${p.expected}“`,
  separationPassed: (p: { duration: string; sampleRate: number; ratio: string; finite: boolean }) =>
    `${p.duration} s · ${p.sampleRate} Hz · Stimme ${p.finite ? `${p.ratio} dB` : "weit"} über dem Hintergrund`,
  speechPassed: (p: { duration: string; sampleRate: number }) => `${p.duration} s · ${p.sampleRate} Hz`,
  imagePassed: (p: { width: number; height: number; steps: number }) => `${p.width}×${p.height} · ${p.steps} Schritte`,

  envLocked: "Der Modellordner wird durch BAOCUT_MODELS_DIR festgelegt. Zum Ändern die Variable anpassen und BaoCut neu starten",
  movingDirWaitOrCancel: "Der Modellordner wird verschoben. Erst nach Abschluss oder Abbruch ändern",
  folderMissing: "Dieser Ordner ist nicht vorhanden (auch bei nicht angeschlossenem externem Laufwerk)",
  folderNotWritable: "BaoCut hat keine Schreibberechtigung für diesen Ordner",
  dirNested: "Der neue Speicherort und der aktuelle Modellordner liegen ineinander. Einen Ordner wählen, der weder darin liegt noch ihn enthält",
  noSpaceForMove: "Die Festplatte am neuen Speicherort hat nicht genug Platz für die Modelle",
  noSpaceRemedy: "Speicher freigeben, einen anderen Speicherort wählen oder „Nur den Speicherort wechseln“ auswählen",
  dirInUse: "Aufgaben verwenden lokale Modelle. Modellordner erst nach Abschluss oder Abbruch ändern",
  sourceKept: (p: { count: number }) =>
    `${p.count} ${pluralForm('de', p.count, { one: "Repository", other: "Repositorys" })} im alten Ordner konnten nicht gelöscht werden. Sie können manuell gelöscht werden`,
  moveNoSpace: "Die Festplatte am neuen Speicherort wurde voll. Die Verschiebung wurde rückgängig gemacht",
  moveFailed: "Beim Verschieben der Modelle ist ein Fehler aufgetreten. Die Verschiebung wurde rückgängig gemacht",
  moveFailedRemedy: "Der ursprüngliche Modellordner ist unverändert und die Modelle funktionieren weiterhin",

  noAlignableFormat: (p: { modelId: string }) => `Modell ${p.modelId} gibt kein ausrichtbares Audioformat aus`,
  synthOutputCount: (p: { count: number }) => `Die Sprachsynthese hat erzeugt: ${p.count} Ergebnisse; erwartet wird 1`,
  synthOutputOutsideStaging: "Das Sprachsyntheseergebnis liegt nicht im Bereitstellungsordner",
  dubGrantHint: (p: { recipient: string }) =>
    `Vertonung sendet das Transkript (Übersetzung sowie das Original bei fehlender Übersetzung) an ${p.recipient}. Die Standardberechtigung beim Aktivieren eines Anbieters umfasst keine Transkripte; der Benutzer muss ausdrücklich eine Berechtigung erteilen (mit dem folgenden Befehl oder in den BaoCut-Einstellungen) und die Vertonung erneut ausführen.`,
  voiceRemoved: (p: { reason: string; voice: string }) => `${p.reason}: Stimme ${p.voice}`,

  notSpeakersJob: "Diese Aufgabe ist keine Sprechererkennung",
  jobNotForVideo: "Diese Erkennung gehört nicht zu diesem Video",
  speakersNotDone: "Die Sprechererkennung ist noch nicht abgeschlossen",
  speakersCleaned: "Die Erkennungsergebnisse wurden bereinigt. Sprecher erneut erkennen",

  recoveryPrincipalName: "Aufgabenwiederherstellung",
};
