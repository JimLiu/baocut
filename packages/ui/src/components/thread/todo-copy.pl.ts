import type { TodoMessages } from './todo-copy.ts';

export const pl: TodoMessages = {
  label: 'Lista zadań agenta',
  summary: (done, total, current) => (current ? `${done}/${total} · ${current}` : `${done}/${total}`),
  status: { completed: 'Gotowe', inProgress: 'W toku', pending: 'Do zrobienia' },
};
