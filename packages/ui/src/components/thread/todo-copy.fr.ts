import type { TodoMessages } from './todo-copy.ts';

export const fr: TodoMessages = {
  label: 'Tâches de l’agent',
  summary: (done, total, current) => (current ? `${done}/${total} · ${current}` : `${done}/${total}`),
  status: { completed: 'Terminée', inProgress: 'En cours', pending: 'À faire' },
};
