import type { JobsSubtitleFileMessages } from './subtitle-file.ts';

export const nl: JobsSubtitleFileMessages = {
  tooLarge: (p: { bytes: number; limit: number }) => `Het ondertitelbestand heeft ${p.bytes} bytes en overschrijdt de limiet van ${p.limit}`,
  tooManyCues: (p: { limit: number }) => `Meer dan ${p.limit} ondertitels`,
  invalidAt: (p: { line: number; problem: string }) => `Ondertitelbestand, regel ${p.line}: ${p.problem}`,
  nul: "Het bestand bevat NUL-tekens en lijkt niet op tekstondertitels",
  vttHeader: "Een WebVTT-bestand moet beginnen met WEBVTT",
  vttHeaderBlank: "Laat een lege regel na de WEBVTT-header vóór de ondertitels",
  empty: "Het bestand bevat geen ondertitels",
  noTiming: "Dit blok bevat tekst maar geen timingregel",
  tooManyIdLines: "Er mag maar één nummer- of identificatieregel vóór de timingregel staan",
  srtIndex: (p: { id: string }) => `Een SRT-indexregel moet een getal zijn: ${p.id}`,
  badTiming: (p: { timing: string }) => `Ongeldige timingregel: ${p.timing}`,
  endBeforeStart: "De eindtijd ligt vóór de begintijd",
  timingInText: "Er staat een timingregel in de ondertiteltekst (er ontbreekt mogelijk een lege regel tussen twee ondertitels)",
  cueTooLong: (p: { max: number }) => `Een ondertiteltekst is langer dan ${p.max} tekens`,
  minuteSecondRange: "Minuten of seconden zijn hoger dan 59",
};
