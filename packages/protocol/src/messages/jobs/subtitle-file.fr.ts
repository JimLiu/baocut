import type { JobsSubtitleFileMessages } from './subtitle-file.ts';

export const fr: JobsSubtitleFileMessages = {
  tooLarge: (p: { bytes: number; limit: number }) => `Le fichier de sous-titres fait ${p.bytes} octets, au-delà de la limite de ${p.limit}`,
  tooManyCues: (p: { limit: number }) => `Plus de ${p.limit} sous-titres`,
  invalidAt: (p: { line: number; problem: string }) => `Ligne du fichier de sous-titres ${p.line} : ${p.problem}`,
  nul: "Le fichier contient des caractères NUL et ne semble pas être des sous-titres texte",
  vttHeader: "Un fichier WebVTT doit commencer par WEBVTT",
  vttHeaderBlank: "Laissez une ligne vide après l’en-tête WEBVTT avant les sous-titres",
  empty: "Le fichier ne contient aucun sous-titre",
  noTiming: "Ce bloc contient du texte sans ligne temporelle",
  tooManyIdLines: "Une seule ligne de numéro ou identifiant peut précéder la ligne temporelle",
  srtIndex: (p: { id: string }) => `Un index SRT doit être un nombre : ${p.id}`,
  badTiming: (p: { timing: string }) => `Ligne temporelle mal formée : ${p.timing}`,
  endBeforeStart: "La fin précède le début",
  timingInText: "Une ligne temporelle apparaît dans le texte (ligne vide peut-être manquante entre deux sous-titres)",
  cueTooLong: (p: { max: number }) => `Le texte d’un sous-titre dépasse ${p.max} caractères`,
  minuteSecondRange: "Les minutes ou secondes dépassent 59",
};
