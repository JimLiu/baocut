import type { JobsPipelineRunnerMessages } from './pipeline-runner.ts';

export const nl: JobsPipelineRunnerMessages = {
  unknownPipeline: (p: { name: string }) => `Geen pipeline met de naam ‘${p.name}’`,
  entryTargetUnsupported: "Deze Runtime kan geen video’s openen vanuit Space-items",
  targetMismatch: "De parameters target en videoId verwijzen naar verschillende video’s",
  noLibrary: "Deze Runtime heeft geen gebruikersbibliotheek",
  notPipeline: "Deze taak is geen pipeline",
  notRetryable: "Alleen mislukte, geannuleerde of onderbroken pipelines kunnen opnieuw worden geprobeerd",
  pipelineMissing: (p: { name: string }) => `Deze Runtime heeft geen pipeline met de naam ‘${p.name}’`,
  alreadyRetrying: "De pipeline wordt al opnieuw geprobeerd",
  cannotOpenTarget: "Deze Runtime kan de doelvideo van de pipeline niet openen",
  targetReplaced: "Er staat nu een andere video op de doellocatie. Begin opnieuw.",
  pipelineFailed: "De pipeline heeft een fout aangetroffen",
  stepFailed: "De stap heeft een fout aangetroffen",
  interrupted: "De Runtime is gestopt voordat de pipeline klaar was. Gebruik pipelines.retry om verder te gaan vanaf de stap waar die stopte.",

  subtask: (p: { step: string; label: string }) => `${p.step}: ${p.label}`,
};
