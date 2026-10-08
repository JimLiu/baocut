import type { JobsSpeechWorkerMessages } from './speech-worker.ts';

export const fr: JobsSpeechWorkerMessages = {
  incompatible: (p: { protocol: string }) => `Le protocole du Speech Worker n’est pas ${p.protocol}`,
  exited: "Speech Worker s’est arrêté inopinément",
  translationLanguage: "La langue de la traduction ne correspond pas à la langue cible",
  outputInvalid: "La sortie du Speech Worker ne respecte pas le contrat",
  outputTruncated: "La sortie du modèle a atteint la limite et a été tronquée",
  resultMissing: (p: { field: string }) => `Il manque au résultat du Speech Worker ${p.field}`,
  unreadableFile: (p: { name: string }) => `Impossible de lire ${p.name} écrit par Speech Worker`,
  cuesNotObject: "Les cues ne sont pas un objet",
  cuesSchema: (p: { schema: string }) => `Le schéma des cues doit être ${p.schema}`,
  cuesLanguage: "La langue des cues ne correspond pas à la langue cible",
  cuesTimescale: "Le timescale des cues doit correspondre à celui de la transcription source",
  cuesMissing: "cues est manquant",
  cueNotObject: (p: { n: number }) => `Le cue ${p.n} n’est pas un objet`,
  cueNoText: (p: { n: number }) => `Le cue ${p.n} n’a aucun texte`,
  cueNoSentence: (p: { n: number }) => `Le cue ${p.n} n’a pas de phrase ou unité`,
  cueFallback: (p: { n: number }) => `Le cue ${p.n} : fallback n’est pas un booléen`,
  cueTicks: (p: { n: number }) => `Le cue ${p.n} : les horaires ne sont pas des ticks entiers`,
  cueRange: (p: { n: number }) => `Le cue ${p.n} a une plage temporelle invalide`,
  cueOverlap: (p: { n: number }) => `Le cue ${p.n} chevauche le précédent ou n’est pas dans l’ordre`,
  cueBeyond: (p: { n: number }) => `Le cue ${p.n} dépasse la durée du média`,
};
