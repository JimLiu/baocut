import type { JobsTranslateSubtitlesMessages } from './translate-subtitles.ts';

export const fr: JobsTranslateSubtitlesMessages = {
  label: "Traduire le fichier de sous-titres",
  description:
    "Traduit un fichier SRT ou WebVTT dans une autre langue, sous-titre par sous-titre, et écrit un nouveau fichier. Nombre et codes temporels inchangés ; résultat bilingue ou autre format possible. La vidéo reste inchangée.",
  stepRead: "Lire les sous-titres",
  stepTranslate: "Traduire",
  stepCheck: "Vérification",
  stepPublish: "Publier",
  noStructuredOutput: (p: { model: string }) => `Le modèle ${p.model} ne prend pas en charge la sortie structurée et ne peut donc pas servir à la traduction`,
  artifactGone: (p: { artifactId: string }) => `Le résultat ${p.artifactId} n’existe plus`,
  paramNotAbsolute: (p: { key: string }) => `Le paramètre ${p.key} doit être un chemin absolu`,
  inputNotSubtitle: "Le paramètre input doit être un fichier .srt ou .vtt",
  languageInvalid: (p: { key: string }) => `Le paramètre ${p.key} doit être une étiquette de langue BCP 47`,
  bilingualInvalid: "Le paramètre bilingual doit être true ou false",
  fileNotFound: (p: { file: string }) => `Fichier de sous-titres introuvable ${p.file}`,
  fileTooLarge: (p: { bytes: number; limit: number }) => `Le fichier de sous-titres fait ${p.bytes} octets, au-delà de la limite de ${p.limit}`,
  noText: "Le fichier de sous-titres n’a aucun texte à traduire",
  allEmpty: "Tous les sous-titres sont vides",
  markupStripped: (p: { count: number }) =>
    `${p.count} sous-titres contenaient un balisage (italique, couleur, position, etc.) non conservé dans la traduction`,
  cueNoTranslation: (p: { n: number }) => `Le sous-titre ${p.n} n’a aucune traduction`,
  rereadFailed: "Impossible de relire les sous-titres écrits",
  cueCountMismatch: (p: { written: number; original: number }) => `Écrit : ${p.written} sous-titres ; le fichier original en contient ${p.original}`,
  timingChanged: (p: { n: number; from: string; to: string }) => `Le code temporel du sous-titre ${p.n} a changé : ${p.from} → ${p.to}`,
  cannotMatch: "La traduction ne peut pas être écrite en sous-titres correspondant un à un au fichier original",
  settingsDropped: (p: { settings: number; blocks: number }) =>
    `Converti en SRT : les réglages de cues de ${p.settings} sous-titres et ${p.blocks} blocs NOTE, STYLE et REGION ne sont pas compatibles et n’ont pas été conservés`,
};
