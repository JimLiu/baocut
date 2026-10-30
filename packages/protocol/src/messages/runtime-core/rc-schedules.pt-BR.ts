import type { RcSchedulesMessages } from './rc-schedules.ts';

export const ptBR: RcSchedulesMessages = {
  notFound: (p) => `Tarefa agendada não encontrada: ${p.id}`,
  conversationNotFound: (p) => `Sessão não encontrada: ${p.id}`,
  conversationArchived: 'Esta sessão está arquivada. Restaure-a em Sessões arquivadas antes de agendá-la.',
  noProject: 'Esta sessão não está em um projeto, então não pode abrir uma nova sessão em um projeto a cada vez.',
  invalid: 'Confira a tarefa agendada: a mensagem, a frequência e o limite de execuções precisam ser válidos.',
  notActive: 'Só uma tarefa agendada ativa pode ser executada agora.',
  resumeArchived:
    'A sessão de destino está arquivada. Restaure-a em Sessões arquivadas ou edite a tarefa agendada para abrir uma nova sessão a cada vez.',
  resumeDeleted: 'A sessão de destino foi excluída. Edite a tarefa agendada para abrir uma nova sessão a cada vez.',
  resumeProjectRemoved: 'O projeto foi removido do BaoCut, então não é possível abrir uma nova sessão nele.',
  resumeCompleted: 'Já executou o número máximo de vezes. Aumente o limite antes de continuar.',
  runStopped: 'Parou antes de terminar',
};
