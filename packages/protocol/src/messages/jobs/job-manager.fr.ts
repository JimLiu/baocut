import { pluralForm } from '../../i18n.ts';
import type { JobsManagerMessages } from './job-manager.ts';

export const fr: JobsManagerMessages = {

  runtimeStopping: "Le Runtime s’arrête",
  jobNotFound: "La tâche n’existe pas",
  noBundle: "Paquet de modèle inconnu",
  noBundleId: (p: { bundleId: string }) => `Paquet de modèle inconnu : ${p.bundleId}`,
  jobIdExists: "L’identifiant de tâche existe déjà",
  onlyHostedRerun: "Seules les tâches hébergées peuvent être réexécutées ainsi",
  notEnded: "La tâche n’est pas encore terminée",
  hintTooLong: "L’indication terminologique ne peut pas dépasser 1200 caractères",
  onlyAudioVideo: "Seuls les médias audio ou vidéo peuvent être transcrits",
  pathNotAbsolute: "Les chemins doivent être absolus",
  trackInvalid: "track doit être un entier positif ou nul",
  noGeneration: "Ce Runtime ne fournit pas la génération",
  videoNotOpen: "La vidéo n’est pas ouverte",
  contentHashInvalid: "L’empreinte du contenu doit être sha256:<hex>",
  timescaleInvalid: "timescale doit être un entier positif",
  rangeInvalid: "range est invalide",
  bundleCannotTranscribe: "Ce paquet de modèle ne peut pas transcrire",
  bundleUnavailable: "Le paquet de modèle est actuellement indisponible",
  localInferenceUnavailable: "Inférence locale indisponible",
  invalidLanguageTag: (p: { tag: string }) => `Étiquette de langue BCP 47 invalide : ${p.tag}`,
  cannotReadInput: "Impossible de lire le fichier d’entrée",

  jobReconciling: "Cette tâche est en cours de récupération ou de rapprochement",
  openVideoToRetry: "La vidéo n’est pas ouverte ; ouvrez-la puis réessayez",
  openVideoToApply: "La vidéo n’est pas ouverte ; ouvrez-la puis appliquez",
  receiptUnknownLater: "Reçu de dernière validation introuvable ; réessayez plus tard",
  receiptUnknown: "Reçu de dernière validation introuvable",
  requeueCheckFailed: "Vérification préalable à la remise en file en échec",
  assetVersionGone: "Le média ou sa version n’est plus dans la vidéo",
  assetChanged: "Le contenu du média a changé",
  cannotRerun: "Cette tâche ne peut pas être réexécutée",
  cannotOpenVideoAfterRestart: "Impossible d’ouvrir la vidéo après redémarrage",
  videoNotOpenNoPlace: "La vidéo n’est pas ouverte et son emplacement est inconnu",
  videoFolderGone: "Le dossier de la vidéo n’existe plus",
  videoReplaced: "Une autre vidéo se trouve à l’ancien emplacement",
  recoverFailed: "Échec de récupération de la tâche",
  interrupted: "La tâche n’était pas terminée à l’arrêt du Runtime ; vous pouvez la soumettre à nouveau",
  needsReconciliation:
    "Un appel sortant n’avait pas répondu à l’arrêt du Runtime ; son exécution et sa facturation distantes sont inconnues. Choisissez de réessayer ou d’abandonner (aucun renvoi automatique)",

  executeFailed: "Échec d’exécution de la tâche",
  providerUnavailable: "Fournisseur indisponible",
  executorGone: "L’exécuteur de la tâche a disparu",
  localCrashedAfterRetry: "Le processus d’inférence locale a encore planté après une nouvelle tentative",
  transcribeFailedAfterRetry: "La transcription a encore échoué après une nouvelle tentative",

  outputCountMismatch: (p: { actual: number; expected: number }) =>
    `Il y ${pluralForm('fr', p.actual, { one: `a ${p.actual} résultat`, other: `a ${p.actual} résultats` })}, mais ${p.expected} ${pluralForm('fr', p.expected, { one: "était", other: "étaient" })} demandés`,
  outputNotInStaging: (p: { n: number }) => `Le résultat ${p.n} n’est pas dans le dossier temporaire`,
  outputMissing: (p: { n: number }) => `Le résultat ${p.n} n’existe pas`,
  outputLengthMismatch: (p: { n: number; actual: number; declared: number }) =>
    `Le résultat ${p.n} est ${p.actual} octets, mais ${p.declared} ont été déclarés`,
  outputShaMismatch: (p: { n: number }) => `Le résultat ${p.n} : sha256 ne correspond pas à celui déclaré`,
  outputTypeMismatch: (p: { n: number; actual: string; expected: string }) =>
    `Le résultat ${p.n} est ${p.actual}, mais ${p.expected} a été demandé`,
  outputProblem: (p: { n: number; problem: string }) => `Le résultat ${p.n} : ${p.problem}`,
  noTextResult: "L’exécuteur n’a renvoyé aucun résultat texte",
  textOutputCount: (p: { actual: number }) => `Il y a ${p.actual} résultats ; il devrait y en avoir 1`,
  textNotInStaging: "Le résultat n’est pas dans le dossier temporaire",
  textMissing: "Le résultat n’existe pas",
  textLengthMismatch: (p: { actual: number; declared: number }) => `Le résultat fait ${p.actual} octets, mais ${p.declared} ont été déclarés`,
  textShaMismatch: "Le sha256 du résultat ne correspond pas à celui déclaré",
  textTypeMismatch: (p: { actual: string; expected: string }) => `Le résultat fait ${p.actual}, mais ${p.expected} a été demandé`,
  notUtf8: "Le résultat n’est pas en UTF-8 valide",
  notJson: "Le résultat n’est pas un JSON valide",
  emptyOutput: "Le résultat est vide",
  generatedInvalid: "Le résultat généré n’a pas réussi la vérification de décodage",

  asrFileNotInStaging: "Le fichier résultat n’est pas dans le dossier temporaire",
  asrFileMissing: "Le fichier résultat n’existe pas",
  asrLengthMismatch: (p: { actual: number; declared: number }) => `Le résultat fait ${p.actual} octets, mais la réponse indiquait ${p.declared}`,
  asrShaMismatch: "Le sha256 du résultat ne correspond pas à la réponse",
  asrContractInvalid: "La sortie du modèle ne respecte pas baocut.asr-result/v1",

  outputTruncated: (p: { limit: number }) => `La sortie a atteint la limite (${p.limit} tokens) et a été tronquée ; contenu incomplet`,
  saveCopyFailed: (p: { dir: string; reason: string }) => `Impossible d’écrire une copie dans ${p.dir} : ${p.reason}`,

  applyError: "Échec d’écriture dans la vidéo",
  transcribeLabel: "Transcrire",
  voiceOverLabel: "Générer le doublage",
  imageLabel: "Générer une image",
  videoClosed: "La vidéo a été fermée",
  assetGone: "Le média n’est plus dans la vidéo",
  assetChangedDuringTranscribe: "Le contenu du média a changé pendant la transcription",
  generatedGone: "Le résultat généré n’existe plus",
  asrGone: "Le résultat de transcription n’existe plus",
  asrNotJson: "Le résultat de transcription n’est pas un JSON valide",
  asrInvalid: "Le résultat de transcription ne respecte pas le contrat",
  targetGone: "La cible n’existe plus",
  staleGeneratedKept: (p: { reason: string }) => `${p.reason} ; résultat généré conservé`,
  protectedKept: (p: { generated: boolean }) =>
    `${p.generated ? "Génération" : "Transcription"} terminée, mais le résultat touchait le contenu à préserver dans le contrat ; il n’a pas été écrit dans la vidéo. Résultat conservé ; l’utilisateur décide de son application`,
  applyFailedKept: (p: { generated: boolean }): string =>
    p.generated
      ? "Génération terminée, mais import dans la vidéo en échec ; résultat conservé"
      : "Transcription terminée, mais écriture dans la vidéo en échec ; résultat conservé",
};
