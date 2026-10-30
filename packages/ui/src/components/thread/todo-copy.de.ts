import type { TodoMessages } from './todo-copy.ts';

export const de: TodoMessages = {
  label: 'To-dos des Agenten',
  summary: (done, total, current) => (current ? `${done}/${total} · ${current}` : `${done}/${total}`),
  status: { completed: 'Erledigt', inProgress: 'In Arbeit', pending: 'Offen' },
};
