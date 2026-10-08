import type { JobsPipelineRunnerMessages } from './pipeline-runner.ts';

export const pl: JobsPipelineRunnerMessages = {
  unknownPipeline: (p: { name: string }) => `Brak potoku o nazwie „${p.name}"`,
  entryTargetUnsupported: "Ten Runtime nie może otwierać wideo z wpisów Space",
  targetMismatch: "Parametry target i videoId odwołują się do różnych wideo",
  noLibrary: "Ten Runtime nie ma biblioteki użytkownika",
  notPipeline: "To zadanie nie jest potokiem",
  notRetryable: "Można ponowić tylko potoki nieudane, anulowane lub przerwane",
  pipelineMissing: (p: { name: string }) => `Ten Runtime nie ma potoku o nazwie „${p.name}"`,
  alreadyRetrying: "Potok jest już ponawiany",
  cannotOpenTarget: "Ten Runtime nie może otworzyć docelowego wideo potoku",
  targetReplaced: "W lokalizacji docelowej jest teraz inne wideo. Zacznij od nowa.",
  pipelineFailed: "W potoku wystąpił błąd",
  stepFailed: "W kroku wystąpił błąd",
  interrupted: "Runtime zatrzymał się przed ukończeniem potoku. Użyj pipelines.retry, aby kontynuować od kroku, na którym się zatrzymał.",
  subtask: (p: { step: string; label: string }) => `${p.step}: ${p.label}`,
};
