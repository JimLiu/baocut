import { pluralForm } from '../../i18n.ts';
import type { EngineHostMessages } from './engineHost.ts';

export const pl: EngineHostMessages = {
  runGenerationNotInteger: "runGeneration musi być całkowitą liczbą dziesiętną",
  secondsInvalid: (p) => `${p.field} musi być skończoną liczbą sekund, co najmniej 0`,
  secondsOverflow: (p) => `${p.field} jest poza zakresem`,
  audioItemsKind: "audioItems dotyczy tylko planów audio i wideo",
  skipAssetsKind: "skipAssets dotyczy tylko planów wideo",
  outputKind: "output dotyczy tylko planów wideo",
  outputSize: "Szerokość i wysokość wyniku muszą być dodatnimi liczbami całkowitymi",
  tooManyRanges: (p) => pluralForm('pl', Number(p.max), { one: `Najwyżej ${p.max} zakres naraz`, few: `Najwyżej ${p.max} zakresy naraz`, many: `Najwyżej ${p.max} zakresów naraz`, other: `Najwyżej ${p.max} zakresu naraz` }),
  textPlanNoDocument: "Plan tekstowy wymaga co najmniej jednego dokumentu",
  textPlanTooManyDocuments: "Plan tekstowy przyjmuje najwyżej dwa dokumenty (główny i drugi dla połączenia dwujęzycznego)",
  planKindUnknown: (p) => `Nieznany rodzaj planu ${p.kind}`,
  unknownMethod: (p) => `Nieznana metoda: ${p.method}`,
  paramsInvalid: (p) => `Nieprawidłowe parametry: ${p.error}`,
  fontFacesInvalid: (p) => `Podaj od 1 do ${p.max} odmian: nazwa każdej rodziny niepusta i do 200 znaków, grubość od 1 do 1000`,
  cacheDirRelative: "cacheDir musi być ścieżką bezwzględną",
  fontPathRelative: "path musi być ścieżką bezwzględną",
  fontInvalid: (p) => `Nieprawidłowy plik czcionki: ${p.error}`,
  videoPathRelative: "Ścieżka wideo musi być bezwzględna",
  videoNotOpen: "Wideo nie jest otwarte",
  taskStopped: "Wykonanie zatrzymano i nie zapisano zmiany",
  afterNotInteger: "after musi być całkowitą liczbą dziesiętną",
  enginePanic: "Silnik nie obsłużył żądania i nie zapisano zmiany",
  pathRelative: "Ścieżki muszą być bezwzględne",
};
