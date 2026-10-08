type P<K extends string> = Record<K, string | number>;
import type { EngineHostMessages } from './engineHost.ts';

export const nl: EngineHostMessages = {
  runGenerationNotInteger: "runGeneration moet een decimaal geheel getal zijn",
  secondsInvalid: (p: P<'field'>) => `${p.field} moet een eindig aantal seconden van minstens 0 zijn`,
  secondsOverflow: (p: P<'field'>) => `${p.field} ligt buiten het bereik`,
  audioItemsKind: "audioItems is alleen voor audio- en videoplannen",
  skipAssetsKind: "skipAssets is alleen voor videoplannen",
  outputKind: "output is alleen voor videoplannen",
  outputSize: "De breedte en hoogte van de uitvoer moeten positieve gehele getallen zijn",
  tooManyRanges: (p: P<'max'>) => `Maximaal ${p.max} bereiken tegelijk`,
  textPlanNoDocument: "Een tekstplan vereist minstens één document",
  textPlanTooManyDocuments: "Een tekstplan accepteert maximaal twee documenten (het hoofddocument en het andere van een tweetalige samenvoeging)",
  planKindUnknown: (p: P<'kind'>) => `Onbekend plantype ${p.kind}`,
  unknownMethod: (p: P<'method'>) => `Onbekende methode: ${p.method}`,
  paramsInvalid: (p: P<'error'>) => `Ongeldige parameters: ${p.error}`,
  fontFacesInvalid: (p: P<'max'>) => `Aantal lettertypen: 1 tot ${p.max}; elke familienaam mag niet leeg zijn en maximaal 200 tekens bevatten, elke dikte moet tussen 1 en 1000 liggen`,
  cacheDirRelative: "cacheDir moet absoluut zijn",
  fontPathRelative: "path moet absoluut zijn",
  fontInvalid: (p: P<'error'>) => `Geen bruikbaar lettertypebestand: ${p.error}`,
  videoPathRelative: "Het videopad moet absoluut zijn",
  videoNotOpen: "De video is niet geopend",
  taskStopped: "Deze uitvoering is gestopt en de wijziging is niet vastgelegd",
  afterNotInteger: "after moet een decimaal geheel getal zijn",
  enginePanic: "De engine is mislukt tijdens het verwerken van het verzoek en de wijziging is niet vastgelegd",
  pathRelative: "Paden moeten absoluut zijn",
};
