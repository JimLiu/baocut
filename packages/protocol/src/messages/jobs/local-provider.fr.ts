import { pluralForm } from '../../i18n.ts';
import type { JobsLocalProviderMessages } from './local-provider.ts';

export const fr: JobsLocalProviderMessages = {
  assetUnreadable: "Impossible de lire le média",
  notHandled: (p: { capability: string }) => `Le fournisseur local n’exécute pas ${p.capability}`,
  referenceChanged: "L’enregistrement de référence a changé depuis sa soumission",
  referenceUnreadable: "Impossible de lire l’enregistrement de référence",
  speechOutputWrong: (p: { file: string }) => `Le résultat synthétisé n’est pas ${p.file} dans la zone temporaire`,
  stemOutputWrong: (p: { file: string }) => `Le résultat séparé n’est pas ${p.file} dans la zone temporaire`,
  speakersOutputWrong: (p: { file: string }) => `Le résultat d’identification des locuteurs n’est pas ${p.file} dans la zone temporaire`,
  imageNoInput: "La génération locale d’images n’a aucun fichier d’entrée",
  imageOutputWrong: (p: { file: string }) => `Le résultat image n’est pas ${p.file} dans la zone temporaire`,
  runtimeStopping: "Le Runtime s’arrête",
  bundleRequired: "L’inférence locale nécessite un paquet de modèle",
  bundleDisabled: "Le paquet de modèle est désactivé",
  workerBusy: "Le Worker de ce paquet exécute une autre tâche",
  workerVersionChanged: "La version du Worker diffère de la première tentative ; aucune nouvelle tentative automatique",
  noOutput: "job.run a renvoyé completed sans résultat",
  workerExitedDuringJob: "Model Worker s’est arrêté pendant la tâche",
  inferenceFailed: (p: { code: string }) => `Échec d’inférence : ${p.code}`,
  stagingUnwritable: "Impossible d’écrire le résultat dans la zone temporaire ; vérifiez l’espace disque",
  workerUnsupported: (p: { message: string }) => `Model Worker ne prend pas en charge cette tâche : ${p.message}`,
  jobRunReturned: (p: { code: string }) => `job.run a renvoyé ${p.code}`,
  workerNotFound: "Model Worker (model-worker) introuvable",
  workerCannotStart: "Impossible de démarrer Model Worker",
  workerExitedOnStart: "Model Worker s’est arrêté juste après le démarrage",
  handshakeFailed: "Échec de négociation avec Model Worker",
  contractMismatch: "La version du contrat Model Worker ne correspond pas",
  backendUnavailable: (p: { backend: string }) => `Ce Model Worker ne peut pas utiliser le moteur ${p.backend}`,
  cannotSeparate: "Ce Model Worker ne peut pas encore séparer localement voix et fond sonore avec ce modèle",
  cannotGenerateImage: "Ce Model Worker ne peut pas encore générer localement des images avec ce modèle",
  cannotDiarize: "Ce Model Worker ne peut pas encore identifier les locuteurs localement",
  cannotTranscribe: "Ce Model Worker ne peut pas encore transcrire localement avec ce modèle",
  cannotSynthesize: "Ce Model Worker ne peut pas encore effectuer une synthèse vocale locale avec ce modèle",
  loadFailed: (p: { reason: string }) => `Échec de chargement du paquet de modèle : ${p.reason}`,
  workerExitedOnLoad: "Model Worker s’est arrêté pendant le chargement",
  crashedRepeatedly: (p: { minutes: number; count: number }) =>
    `Planté ${p.count} ${pluralForm('fr', p.count, { one: "fois", other: "fois" })} en ${p.minutes} ${pluralForm('fr', p.minutes, { one: "minute", other: "minutes" })}`,

  readingDroppedOne: (p: { at: number; reading: string; origin: string }) =>
    `Le caractère ${p.at} n’a pas été synthétisé avec la lecture « ${p.reading} » (${p.origin})`,
  readingDroppedRange: (p: { from: number; to: number; reading: string; origin: string }) =>
    `Les caractères ${p.from}–${p.to} n’ont pas été synthétisés avec la lecture « ${p.reading} » (${p.origin})`,
};
