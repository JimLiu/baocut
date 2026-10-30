import type { TodoMessages } from './todo-copy.ts';

export const ptBR: TodoMessages = {
  label: 'Tarefas do agente',
  summary: (done, total, current) => (current ? `${done}/${total} · ${current}` : `${done}/${total}`),
  status: { completed: 'Concluída', inProgress: 'Em andamento', pending: 'Pendente' },
};
