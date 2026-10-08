import type { HarnessRunsMessages } from './harness-runs.ts';

export const ptBR: HarnessRunsMessages = {
  retrying: (p) => `${p.message} (tentando novamente)`,
  modeChanged: (p) => `Modo de acesso alterado para “${p.to}” (era “${p.from}”). Aplica-se às ações seguintes.`,
  jobsCancelled: (p) => `Solicitado cancelamento das tarefas em segundo plano não concluídas desta sessão (${p.count}). Os resultados concluídos são mantidos.`,
  jobsCancelledGenerated: (p) => `Solicitado cancelamento das tarefas em segundo plano não concluídas desta sessão (${p.count}, geração ou transcrição). Os resultados concluídos são mantidos.`,
  goalChangedStopped: "Objetivo alterado: a tarefa anterior foi interrompida. Iniciando uma nova tarefa para o novo objetivo.",
  goalChangedKept: "Objetivo alterado: o turno da tarefa anterior foi interrompido. Tarefas em segundo plano já enviadas terminam normalmente e seus resultados ficam como candidatos. Iniciando uma nova tarefa para o novo objetivo.",
  stopReplyUnconfirmed: (p) => `Foi solicitado parar de responder, mas não foi possível confirmar se ${p.agent} parou.`,
  stopUnconfirmed: (p) => `Foi solicitado parar, mas não foi possível confirmar se ${p.agent} parou.`,
  stopTimedOut: (p) => `${p.agent} não confirmou a parada em 10 segundos, então seu processo foi encerrado. Etapas sem cancelamento confirmado podem já ter surtido efeito.`,
  agentRemovedNotice: (p) => `O agente ${p.agent} foi removido, então esta tarefa não terminou. Alterações já feitas não são desfeitas automaticamente.`,
  agentRemoved: (p) => `O agente ${p.agent} foi removido`,
  runtimeStoppedNotice: "A tarefa ainda estava em andamento quando o Runtime parou, então foi interrompida.",
  runtimeExitedNotice: "O Runtime saiu durante a execução da tarefa, então ela não terminou. Alterações já feitas não são desfeitas automaticamente.",
  runtimeExited: "O Runtime saiu durante a execução da tarefa",
  turnFailed: "O turno falhou",
  processExited: (p) => `${p.agent} teve o processo encerrado inesperadamente: ${p.error}`,
  noErrorMessage: "nenhuma mensagem de erro",
  fileChangeSummary: "Editar arquivos",
};
