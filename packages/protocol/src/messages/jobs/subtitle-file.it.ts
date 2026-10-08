import type { JobsSubtitleFileMessages } from './subtitle-file.ts';

export const it: JobsSubtitleFileMessages = {
  tooLarge: (p: { bytes: number; limit: number }) => `Il file dei sottotitoli ha ${p.bytes} B, oltre il limite di ${p.limit}`,
  tooManyCues: (p: { limit: number }) => `Più di ${p.limit} sottotitoli`,
  invalidAt: (p: { line: number; problem: string }) => `Riga del file dei sottotitoli ${p.line}: ${p.problem}`,
  nul: "Il file contiene caratteri NUL e non sembra contenere sottotitoli di testo",
  vttHeader: "Un file WebVTT deve iniziare con WEBVTT",
  vttHeaderBlank: "Lascia una riga vuota dopo l’intestazione WEBVTT prima dei sottotitoli",
  empty: "Il file non ha sottotitoli",
  noTiming: "Questo blocco ha testo ma non ha una riga dei tempi",
  tooManyIdLines: "Solo una riga di numero o identificatore può precedere la riga dei tempi",
  srtIndex: (p: { id: string }) => `La riga dell’indice SRT deve essere un numero: ${p.id}`,
  badTiming: (p: { timing: string }) => `Riga dei tempi non valida: ${p.timing}`,
  endBeforeStart: "La fine precede l’inizio",
  timingInText: "Nel testo del sottotitolo compare una riga dei tempi (potrebbe mancare una riga vuota tra due sottotitoli)",
  cueTooLong: (p: { max: number }) => `Il testo di un sottotitolo supera ${p.max} caratteri`,
  minuteSecondRange: "I minuti o i secondi superano 59",
};
