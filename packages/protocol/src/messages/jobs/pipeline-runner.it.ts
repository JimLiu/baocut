import type { JobsPipelineRunnerMessages } from './pipeline-runner.ts';

export const it: JobsPipelineRunnerMessages = {
  unknownPipeline: (p: { name: string }) => `Nessun flusso chiamato «${p.name}»`,
  entryTargetUnsupported: "Questo Runtime non può aprire video dalle voci dello Space",
  targetMismatch: "I parametri target e videoId si riferiscono a video diversi",
  noLibrary: "Questo Runtime non ha una libreria utente",
  notPipeline: "Questa attività non è un flusso",
  notRetryable: "È possibile riprovare solo flussi non riusciti, annullati o interrotti",
  pipelineMissing: (p: { name: string }) => `Questo Runtime non ha un flusso chiamato «${p.name}»`,
  alreadyRetrying: "Il flusso è già in fase di nuovo tentativo",
  cannotOpenTarget: "Questo Runtime non può aprire il video di destinazione del flusso",
  targetReplaced: "Un video diverso si trova ora nella posizione di destinazione. Ricomincia.",
  pipelineFailed: "Il flusso ha incontrato un errore",
  stepFailed: "Il passaggio ha incontrato un errore",
  interrupted: "Il Runtime si è interrotto prima del completamento del flusso. Usa pipelines.retry per continuare dal passaggio in cui si è fermato.",
  subtask: (p: { step: string; label: string }) => `${p.step}: ${p.label}`,
};
