import type { EngineHostMessages } from './engineHost.ts';
import { pluralForm } from '../../i18n.ts';

export const it: EngineHostMessages = {
  runGenerationNotInteger: "runGeneration deve essere un intero decimale",
  secondsInvalid: (p) => `${p.field} deve essere un numero finito di secondi, almeno 0`,
  secondsOverflow: (p) => `${p.field} è fuori intervallo`,
  audioItemsKind: "audioItems è solo per piani audio e video",
  skipAssetsKind: "skipAssets è solo per piani video",
  outputKind: "output è solo per piani video",
  outputSize: "La larghezza e l’altezza dell’output devono essere interi positivi",
  tooManyRanges: (p) => pluralForm('it', Number(p.max), { one: `Fino a ${p.max} intervallo alla volta`, other: `Fino a ${p.max} intervalli alla volta` }),
  textPlanNoDocument: "Un piano text richiede almeno un documento",
  textPlanTooManyDocuments: "Un piano text accetta al massimo due documenti (quello principale e l’altro di un’unione bilingue)",
  planKindUnknown: (p) => `Tipo di piano sconosciuto ${p.kind}`,
  unknownMethod: (p) => `Metodo sconosciuto: ${p.method}`,
  paramsInvalid: (p) => `Parametri non validi: ${p.error}`,
  fontFacesInvalid: (p) => `Indica da 1 a ${p.max} varianti: ogni nome di famiglia non vuoto e di massimo 200 caratteri, ogni peso tra 1 e 1000`,
  cacheDirRelative: "cacheDir deve essere assoluto",
  fontPathRelative: "path deve essere assoluto",
  fontInvalid: (p) => `Non è un file di font utilizzabile: ${p.error}`,
  videoPathRelative: "Il percorso del video deve essere assoluto",
  videoNotOpen: "Il video non è aperto",
  taskStopped: "Questa esecuzione è stata interrotta e la modifica non è stata registrata",
  afterNotInteger: "after deve essere un intero decimale",
  enginePanic: "Il motore ha incontrato un errore durante la gestione della richiesta e la modifica non è stata registrata",
  pathRelative: "I percorsi devono essere assoluti",
};
