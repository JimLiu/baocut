import type { JobsSubtitleFileMessages } from './subtitle-file.ts';

export const pl: JobsSubtitleFileMessages = {
  tooLarge: (p: { bytes: number; limit: number }) => `Rozmiar pliku napisów: ${p.bytes} bajtów, przekracza limit ${p.limit}`,
  tooManyCues: (p: { limit: number }) => `Więcej niż ${p.limit} napisów`,
  invalidAt: (p: { line: number; problem: string }) => `Wiersz pliku napisów ${p.line}: ${p.problem}`,
  nul: "Plik zawiera znaki NUL i nie wygląda jak napisy tekstowe",
  vttHeader: "Plik WebVTT musi zaczynać się od WEBVTT",
  vttHeaderBlank: "Pozostaw pusty wiersz po nagłówku WEBVTT przed napisami",
  empty: "Plik nie zawiera napisów",
  noTiming: "Blok ma tekst, ale nie ma wiersza czasu",
  tooManyIdLines: "Przed wierszem czasu może być tylko jeden wiersz z numerem lub identyfikatorem",
  srtIndex: (p: { id: string }) => `Wiersz indeksu SRT musi być liczbą: ${p.id}`,
  badTiming: (p: { timing: string }) => `Nieprawidłowy wiersz czasu: ${p.timing}`,
  endBeforeStart: "Czas końca poprzedza czas początku",
  timingInText: "W tekście napisów pojawia się wiersz czasu (może brakować pustego wiersza między napisami)",
  cueTooLong: (p: { max: number }) => `Tekst napisu jest dłuższy niż ${p.max} znaków`,
  minuteSecondRange: "Minuty lub sekundy przekraczają 59",
};
