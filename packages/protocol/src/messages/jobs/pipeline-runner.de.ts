import type { JobsPipelineRunnerMessages } from './pipeline-runner.ts';

export const de: JobsPipelineRunnerMessages = {
  unknownPipeline: (p: { name: string }) => `Keine Pipeline mit dem Namen „${p.name}“`,
  entryTargetUnsupported: "Diese Runtime kann keine Videos aus Space-Einträgen öffnen",
  targetMismatch: "Die Parameter target und videoId verweisen auf verschiedene Videos",
  noLibrary: "Diese Runtime hat keine Benutzerbibliothek",
  notPipeline: "Diese Aufgabe ist keine Pipeline",
  notRetryable: "Nur fehlgeschlagene, abgebrochene oder unterbrochene Pipelines können erneut versucht werden",
  pipelineMissing: (p: { name: string }) => `Diese Runtime hat keine Pipeline mit dem Namen „${p.name}“`,
  alreadyRetrying: "Die Pipeline wird bereits erneut versucht",
  cannotOpenTarget: "Diese Runtime kann das Zielvideo der Pipeline nicht öffnen",
  targetReplaced: "Am Zielspeicherort befindet sich jetzt ein anderes Video. Neu beginnen.",
  pipelineFailed: "In der Pipeline ist ein Fehler aufgetreten",
  stepFailed: "Im Schritt ist ein Fehler aufgetreten",
  interrupted: "Die Runtime wurde vor Abschluss der Pipeline gestoppt. Mit pipelines.retry ab dem gestoppten Schritt fortfahren.",

  subtask: (p: { step: string; label: string }) => `${p.step}: ${p.label}`,
};
