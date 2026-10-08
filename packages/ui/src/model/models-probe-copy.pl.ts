import { pluralForm } from '@baocut/protocol';
import type { ModelsProbeMessages } from './models-probe-copy.ts';

export const pl: ModelsProbeMessages = {
  speechText: "Cześć, to test syntezy mowy BaoCut.",
  noResult: "Zadanie zakończono, ale nie otrzymano wyniku.",
  failed: "Zadanie nie powiodło się.",
  cancelled: "Zadanie zostało anulowane.",
  interrupted: "Runtime uruchomił się ponownie, więc test nie został ukończony.",
  unknownOutcome: "Runtime uruchomił się ponownie przed odpowiedzią na to wywołanie, więc wynik jest nieznany.",
  audioFacts: (seconds, khz, type) => `${seconds} s · ${khz} kHz · ${type}`,
  videoFacts: (width, height, seconds, type) => `${width} × ${height} · ${seconds} s · ${type}`,
  textFacts: (entries: number, seconds: string, type: string) => `${pluralForm('pl', entries, { one: `${entries} wpis`, few: `${entries} wpisy`, many: `${entries} wpisów`, other: `${entries} wpisu` })} · ${seconds} s · ${type}`,
  packageFacts: (files: number, type: string) => `${pluralForm('pl', files, { one: `${files} plik`, few: `${files} pliki`, many: `${files} plików`, other: `${files} pliku` })} · ${type}`,
  projectFacts: (clips: number, seconds: string, type: string) => `${pluralForm('pl', clips, { one: `${clips} klip`, few: `${clips} klipy`, many: `${clips} klipów`, other: `${clips} klipu` })} · ${seconds} s · ${type}`,
  chars: (count) => `${count} znaków`,
  inputTokens: (count) => `${count} tokenów wejściowych`,
  outputTokens: (count) => `${count} tokenów wyjściowych`,
  hitLimit: "Osiągnięto limit wyniku",
  filtered: "Zablokowano przez filtr treści dostawcy",
  untested: "Nie testowano",
  testing: "Testowanie…",
  passed: "Test zaliczony",
  passedIn: (seconds) => `Test zaliczony · ${seconds} s`,
};
