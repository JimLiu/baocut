import type { TodoMessages } from './todo-copy.ts';

export const es: TodoMessages = {
  label: 'Tareas del agente',
  summary: (done, total, current) => (current ? `${done}/${total} · ${current}` : `${done}/${total}`),
  status: { completed: 'Hecha', inProgress: 'En curso', pending: 'Pendiente' },
};
