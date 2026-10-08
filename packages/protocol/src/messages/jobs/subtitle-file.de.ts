import type { JobsSubtitleFileMessages } from './subtitle-file.ts';

export const de: JobsSubtitleFileMessages = {
  tooLarge: (p: { bytes: number; limit: number }) => `Die Untertiteldatei hat ${p.bytes} Bytes und überschreitet das Limit von ${p.limit}`,
  tooManyCues: (p: { limit: number }) => `Mehr als ${p.limit} Untertitel`,
  invalidAt: (p: { line: number; problem: string }) => `Untertiteldatei, Zeile ${p.line}: ${p.problem}`,
  nul: "Die Datei enthält NUL-Zeichen und sieht nicht wie Textuntertitel aus",
  vttHeader: "Eine WebVTT-Datei muss mit WEBVTT beginnen",
  vttHeaderBlank: "Nach dem WEBVTT-Kopf eine Leerzeile vor den Untertiteln lassen",
  empty: "Die Datei enthält keine Untertitel",
  noTiming: "Dieser Block enthält Text, aber keine Timing-Zeile",
  tooManyIdLines: "Vor der Timing-Zeile darf nur eine Zahlen- oder Kennungszeile stehen",
  srtIndex: (p: { id: string }) => `Eine SRT-Indexzeile muss eine Zahl sein: ${p.id}`,
  badTiming: (p: { timing: string }) => `Fehlerhafte Timing-Zeile: ${p.timing}`,
  endBeforeStart: "Die Endzeit liegt vor der Startzeit",
  timingInText: "Im Untertiteltext steht eine Timing-Zeile (möglicherweise fehlt eine Leerzeile zwischen zwei Untertiteln)",
  cueTooLong: (p: { max: number }) => `Ein Untertiteltext ist länger als ${p.max} Zeichen`,
  minuteSecondRange: "Minuten oder Sekunden überschreiten 59",
};
