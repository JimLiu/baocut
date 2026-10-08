import type { JobsPipelineRunnerMessages } from './pipeline-runner.ts';

export const fr: JobsPipelineRunnerMessages = {
  unknownPipeline: (p: { name: string }) => `Aucun flux nommé « ${p.name} »`,
  entryTargetUnsupported: "Ce Runtime ne peut pas ouvrir des vidéos depuis des entrées Space",
  targetMismatch: "Les paramètres target et videoId désignent des vidéos différentes",
  noLibrary: "Ce Runtime n’a pas de bibliothèque utilisateur",
  notPipeline: "Cette tâche n’est pas un flux",
  notRetryable: "Seuls les flux en échec, annulés ou interrompus peuvent être relancés",
  pipelineMissing: (p: { name: string }) => `Ce Runtime n’a aucun flux nommé « ${p.name} »`,
  alreadyRetrying: "Une nouvelle tentative de ce flux est déjà en cours",
  cannotOpenTarget: "Ce Runtime ne peut pas ouvrir la vidéo cible du flux",
  targetReplaced: "Une autre vidéo se trouve à l’emplacement cible. Recommencez.",
  pipelineFailed: "Le flux a rencontré une erreur",
  stepFailed: "L’étape a rencontré une erreur",
  interrupted: "Le Runtime s’est arrêté avant la fin du flux. Utilisez pipelines.retry pour reprendre à l’étape d’arrêt.",

  subtask: (p: { step: string; label: string }) => `${p.step} : ${p.label}`,
};
