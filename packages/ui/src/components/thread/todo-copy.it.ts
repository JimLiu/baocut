import type { TodoMessages } from './todo-copy.ts';

export const it: TodoMessages = {
  label: 'Attività dell’agente',
  summary: (done, total, current) => (current ? `${done}/${total} · ${current}` : `${done}/${total}`),
  status: { completed: 'Fatta', inProgress: 'In corso', pending: 'Da fare' },
};
