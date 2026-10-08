import type { JobsDubMessages } from './dub.ts';

export const fr: JobsDubMessages = {
  label: "Doublage traduit",
  description:
    "Double dans une autre langue une transcription de la vidéo : traduit d’abord si nécessaire, synthétise chaque phrase, l’aligne sur l’horaire de la phrase originale et l’applique en groupe de doublage (une piste). Aucun Agent n’est démarré.",
  stepFreezeSource: "Lire la source",
  stepTranslate: "Traduire",
  stepAssemble: "Assembler la traduction",
  stepWrite: "Écrire la traduction",
  stepCheck: "Vérifier la traduction",
  stepSeparate: "Séparer voix et fond sonore",
  stepSynthesize: "Synthétiser les phrases",
  stepAlign: "Aligner les horaires",
  stepApply: "Appliquer le doublage",

  regroupConflict: (p: { params: string }) =>
    `La nouvelle synthèse des phrases (regroup) reprend traduction, langue, voix et traitement de l’audio original du plan de doublage de ce groupe ; elle ne peut pas être combinée avec ${p.params}`,
  orTranslationId: "ou translationId doit être indiqué",
  translationIdNoTranslate: "Avec translationId, aucune traduction ; style, glossary, glossaries, textProvider et textModel ne s’appliquent pas",
  mustBeBooleanValue: "doit être un booléen",
  mustBeObject: "doit être un objet",
  unitsCount: (p: { max: number }) => `doit contenir de 1 à ${p.max} identifiants d’unités de traduction`,
  mustBeUnique: "ne peut pas contenir de doublons",
  seedInvalid: (p: { max: number }) => `doit être « new » ou un entier de 0 à ${p.max}`,

  videoNotOpen: "La vidéo n’est pas ouverte",
  translationFromOther: (p: { translationId: string; from: string; expected: string }) =>
    `La traduction ${p.translationId} a été traduite depuis ${p.from}, pas ${p.expected}`,
  translationLanguage: (p: { translationId: string; language: string; expected: string }) =>
    `La traduction ${p.translationId} est en ${p.language}, pas ${p.expected}`,
  noDocument: (p: { documentId: string }) => `La vidéo n’a aucun document ${p.documentId}`,
  notTranslation: (p: { documentId: string; kind: string }) => `Le document ${p.documentId} est ${p.kind}, pas une traduction`,
  translationNotUsable: (p: { translationId: string; schema: string }) =>
    `La traduction ${p.translationId} n’est pas en ${p.schema} et ne peut pas être utilisée pour le doublage`,
  noPlan: (p: { groupId: string }) => `La vidéo n’a aucun plan pour ce groupe de doublage (${p.groupId})`,
  groupGone: (p: { groupId: string }) => `Ce groupe de doublage (${p.groupId}) n’a plus d’éléments sur la timeline`,
  planNoTranslation: "Le plan de doublage ne contient aucune traduction",
  unitsNotInPlan: (p: { count: number; units: string }) =>
    `${p.count} phrases ne sont pas dans le plan ou la traduction de ce groupe : ${p.units}`,
  planNoVoice: "Le plan ne contient pas le fournisseur, le modèle et la voix de synthèse",
  seedNotAccepted: (p: { model: string }) => `Le modèle ${p.model} n’accepte pas de graine`,

  videoClosed: "La vidéo a été fermée",
  translationGone: "Le document de traduction n’est plus dans la vidéo",
  translationNotSchema: (p: { schema: string }) => `La traduction n’est pas en ${p.schema}`,
  translationNotFromTranscript: "La traduction ne provient pas de cette transcription",
  unitMissingIds: "La traduction contient des unités sans id ou sourceSentenceId",
  separationNotConfigured:
    "La séparation voix et fond a été demandée mais aucune capacité separateAudio n’est configurée. Étape ignorée ; l’audio original est traité tel quel",
  unitsStale: (p: { count: number }) =>
    `${p.count} phrases traduites sont obsolètes (source ou glossaire modifiés, ou marquées obsolètes) et n’ont pas été synthétisées`,
  nothingToDub: "Aucune phrase à doubler : toutes sont obsolètes ou vides",

  separationUnavailable: "La séparation voix et fond sonore n’est plus disponible",
  noSourceAsset: "La transcription n’a aucun média source et ne peut pas être séparée",
  sourceAssetMissing: "Le média source de la transcription est indisponible",
  separationInvalid: "Le résultat de séparation ne respecte pas le contrat",
  inputNoAudio: "L’entrée n’a aucun audio",
  stemNoAudio: (p: { name: string }) => `${p.name} n’a aucun audio`,
  stemSampleRate: (p: { name: string; rate: number; input: number }) =>
    `La fréquence d’échantillonnage de ${p.name} (${p.rate}) diffère de celle de l’entrée (${p.input})`,
  stemDuration: (p: { name: string; duration: number; input: number }) =>
    `${p.name} est ${p.duration} secondes ; l’entrée dure ${p.input} secondes`,

  sentenceJob: (p: { n: number }) => `La phrase ${p.n}`,
  audioUndecodable: "L’audio synthétisé ne peut pas être décodé",
  outputNoAudio: "Le résultat synthétisé ne contient aucun audio",
  synthesisStopped: (p: { cause: string; synthesized: number; remaining: number }) =>
    `${p.cause}. ${p.synthesized} phrases ont été synthétisées et il en reste ${p.remaining} ; réessayer synthétise seulement le reste`,
  synthesisFailed: (p: { failed: number; synthesized: number }) =>
    `${p.failed} phrases n’ont pas pu être synthétisées. Les ${p.synthesized} réussies sont conservées ; réessayer synthétise seulement celles en échec`,
  voicesUnavailableAll: (p: { speakers: string }) =>
    `Les voix associées aux locuteurs (${p.speakers}) sont indisponibles ; aucune phrase n’a pu être synthétisée. Corrigez les voix (clonez-les à nouveau ou ajoutez le consentement), puis réessayez`,
  voicesUnavailable: (p: { count: number; speakers: string }) =>
    `${p.count} phrases non synthétisées car les voix de leurs locuteurs (${p.speakers}) sont indisponibles ; aucune autre voix n’a été substituée`,

  mutedUnvoiced: (p: { count: number }) =>
    `${p.count} éléments muets contiennent aussi des phrases non synthétisées car leur voix est indisponible ; l’audio original de ces phrases a aussi été coupé`,
  unitsOverlong: (p: { count: number; tempo: number }) =>
    `${p.count} phrases ne tiennent toujours pas après accélération à ${p.tempo}× et utilisation du silence suivant ; elles n’ont pas été placées sur la timeline (le texte doit être réécrit)`,
  unitsOffTimeline: (p: { count: number }) =>
    `Les phrases originales de ${p.count} phrases traduites ne sont plus sur la timeline ; elles n’ont pas été placées`,
  nothingPlaced: "Aucune phrase doublée ne tient sur la timeline",
  artifactGone: (p: { artifactId: string }) => `Le résultat ${p.artifactId} n’existe plus`,
  stretchNoAudio: "Aucun audio après changement de vitesse",

  videoClosedKept: "La vidéo a été fermée ; l’audio synthétisé est conservé dans les résultats",
  videoChanged:
    "La vidéo a changé après l’alignement ; rien n’a été appliqué. Réessayer réaligne sur la timeline actuelle (audio synthétisé réutilisé)",
  sequenceGone: "La séquence n’existe plus",
  backgroundMuted:
    "L’audio original a été coupé. S’il mélange voix, musique et ambiance, le fond sonore disparaît aussi (fond non séparé)",
  noTrackOrPlanId: "Identifiant de piste ou plan de doublage non reçu après application",
  applyRejected: "Transaction de doublage refusée ; audio synthétisé conservé dans les résultats",
  planGone: "Le plan de ce groupe de doublage n’est plus dans la vidéo",
  regroupRejected: "Transaction de régénération du doublage refusée ; audio synthétisé conservé dans les résultats",
  planNotSchema: (p: { schema: string }) => `Le plan de doublage n’est pas ${p.schema}`,

  transactionLabel: (p: { language: string }) => `Doublage (${p.language})`,
  regroupLabel: (p: { language: string }) => `Régénérer le doublage (${p.language})`,
  trackName: (p: { language: string }) => `Doublage (${p.language})`,
  assetName: (p: { language: string; n: number }) => `Doublage (${p.language}) phrase ${p.n}`,
  takeAssetName: (p: { language: string; n: number; k: number }) => `Doublage (${p.language}) phrase ${p.n} · prise ${p.k}`,
  itemName: (p: { n: number }) => `Doublage ${p.n}`,
  backgroundName: (p: { language: string }) => `Fond sonore (${p.language})`,
  vocalsName: (p: { language: string }) => `Voix (${p.language})`,
  planName: (p: { language: string }) => `Plan de doublage (${p.language})`,
  duckingName: (p: { language: string }) => `Doublage (${p.language}) atténue l’audio original`,
};
