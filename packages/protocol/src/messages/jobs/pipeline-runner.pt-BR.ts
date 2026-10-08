import type { JobsPipelineRunnerMessages } from './pipeline-runner.ts';

export const ptBR: JobsPipelineRunnerMessages = {
  unknownPipeline: (p: { name: string }) => `Não há fluxo chamado “${p.name}”`,
  entryTargetUnsupported: "Este Runtime não pode abrir vídeos de entradas do Space",
  targetMismatch: "Os parâmetros target e videoId referem-se a vídeos diferentes",
  noLibrary: "Este Runtime não tem biblioteca do usuário",
  notPipeline: "Esta tarefa não é um fluxo",
  notRetryable: "Só é possível tentar novamente fluxos com falha, cancelados ou interrompidos",
  pipelineMissing: (p: { name: string }) => `Este Runtime não tem fluxo chamado “${p.name}”`,
  alreadyRetrying: "Já está sendo feita uma nova tentativa do fluxo",
  cannotOpenTarget: "Este Runtime não pode abrir o vídeo de destino do fluxo",
  targetReplaced: "Agora há outro vídeo no local de destino. Comece de novo.",
  pipelineFailed: "O fluxo encontrou um erro",
  stepFailed: "A etapa encontrou um erro",
  interrupted: "O Runtime parou antes de o fluxo terminar. Use pipelines.retry para continuar a partir da etapa em que parou.",
  subtask: (p: { step: string; label: string }) => `${p.step}: ${p.label}`,
};
