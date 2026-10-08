type P<K extends string> = Record<K, string | number>;
import type { EngineHostMessages } from './engineHost.ts';

export const de: EngineHostMessages = {
  runGenerationNotInteger: "runGeneration muss eine Dezimal-Ganzzahl sein",
  secondsInvalid: (p: P<'field'>) => `${p.field} muss eine endliche Sekundenanzahl von mindestens 0 sein`,
  secondsOverflow: (p: P<'field'>) => `${p.field} liegt außerhalb des Bereichs`,
  audioItemsKind: "audioItems ist nur für Audio- und Videopläne vorgesehen",
  skipAssetsKind: "skipAssets ist nur für Videopläne vorgesehen",
  outputKind: "output ist nur für Videopläne vorgesehen",
  outputSize: "Ergebnisbreite und -höhe müssen positive ganze Zahlen sein",
  tooManyRanges: (p: P<'max'>) => `Höchstens ${p.max} Bereiche gleichzeitig`,
  textPlanNoDocument: "Ein Textplan benötigt mindestens ein Dokument",
  textPlanTooManyDocuments: "Ein Textplan akzeptiert höchstens zwei Dokumente (das Hauptdokument und das zweite einer zweisprachigen Zusammenführung)",
  planKindUnknown: (p: P<'kind'>) => `Unbekannte Planart ${p.kind}`,
  unknownMethod: (p: P<'method'>) => `Unbekannte Methode: ${p.method}`,
  paramsInvalid: (p: P<'error'>) => `Ungültige Parameter: ${p.error}`,
  fontFacesInvalid: (p: P<'max'>) => `Anzahl der Schriften: 1 bis ${p.max}; Familiennamen dürfen nicht leer und höchstens 200 Zeichen lang sein, Schriftstärken müssen zwischen 1 und 1000 liegen`,
  cacheDirRelative: "cacheDir muss absolut sein",
  fontPathRelative: "path muss absolut sein",
  fontInvalid: (p: P<'error'>) => `Keine verwendbare Schriftdatei: ${p.error}`,
  videoPathRelative: "Der Videopfad muss absolut sein",
  videoNotOpen: "Das Video ist nicht geöffnet",
  taskStopped: "Diese Ausführung wurde gestoppt; die Änderung wurde nicht übernommen",
  afterNotInteger: "after muss eine Dezimal-Ganzzahl sein",
  enginePanic: "Bei der Verarbeitung der Anfrage ist ein Engine-Fehler aufgetreten; die Änderung wurde nicht übernommen",
  pathRelative: "Pfade müssen absolut sein",
};
