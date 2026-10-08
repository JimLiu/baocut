import { pluralForm } from '../../i18n.ts';
import type { JobsTranslateSubtitlesMessages } from './translate-subtitles.ts';

export const pl: JobsTranslateSubtitlesMessages = {
  label: "Przetłumacz plik napisów",
  description: "Tłumaczy plik napisów SRT lub WebVTT na inny język, napis po napisie, i zapisuje nowy plik. Liczba napisów i kody czasowe pozostają takie same; wynik może być dwujęzyczny lub w innym formacie. Wideo nie jest zmieniane.",
  stepRead: "Odczytaj napisy",
  stepTranslate: "Przetłumacz",
  stepCheck: "Sprawdzanie",
  stepPublish: "Publikacja",
  noStructuredOutput: (p: { model: string }) => `Model ${p.model} nie obsługuje wyniku strukturalnego, więc nie nadaje się do tłumaczenia`,
  artifactGone: (p: { artifactId: string }) => `Wynik ${p.artifactId} już nie istnieje`,
  paramNotAbsolute: (p: { key: string }) => `Parametr ${p.key} musi być ścieżką bezwzględną`,
  inputNotSubtitle: "Parametr input musi być plikiem .srt lub .vtt",
  languageInvalid: (p: { key: string }) => `Parametr ${p.key} musi być znacznikiem języka BCP 47`,
  bilingualInvalid: "Parametr bilingual musi być true lub false",
  fileNotFound: (p: { file: string }) => `Nie udało się znaleźć pliku napisów ${p.file}`,
  fileTooLarge: (p: { bytes: number; limit: number }) => `Rozmiar pliku napisów: ${p.bytes} bajtów, przekracza limit ${p.limit}`,
  noText: "Plik napisów nie zawiera tekstu do tłumaczenia",
  allEmpty: "Wszystkie napisy są puste",
  markupStripped: (p: { count: number }) => pluralForm('pl', p.count, { one: `${p.count} napis zawierał znaczniki (kursywę, kolor, pozycję itp.), których nie zachowano w tłumaczeniu`, few: `${p.count} napisy zawierały znaczniki (kursywę, kolor, pozycję itp.), których nie zachowano w tłumaczeniu`, many: `${p.count} napisów zawierało znaczniki (kursywę, kolor, pozycję itp.), których nie zachowano w tłumaczeniu`, other: `${p.count} napisu zawierało znaczniki (kursywę, kolor, pozycję itp.), których nie zachowano w tłumaczeniu` }),
  cueNoTranslation: (p: { n: number }) => `Napis ${p.n} nie zawiera tłumaczenia`,
  rereadFailed: "Nie udało się odczytać zapisanych napisów",
  cueCountMismatch: (p: { written: number; original: number }) => `Liczba zapisanych napisów: ${p.written}; w pliku oryginalnym: ${p.original}`,
  timingChanged: (p: { n: number; from: string; to: string }) => `Kod czasowy napisu ${p.n} zmienił się: ${p.from} → ${p.to}`,
  cannotMatch: "Nie można zapisać tłumaczenia jako napisów odpowiadających oryginalnemu plikowi jeden do jednego",
  settingsDropped: (p: { settings: number; blocks: number }) => `Przekonwertowano do SRT: pominięto cue settings napisów (${p.settings}) i bloki NOTE, STYLE i REGION (${p.blocks}), bo format ich nie obsługuje`,
};
