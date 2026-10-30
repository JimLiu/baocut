import type { TodoMessages } from './todo-copy.ts';

export const nl: TodoMessages = {
  label: 'Takenlijst van de agent',
  summary: (done, total, current) => (current ? `${done}/${total} · ${current}` : `${done}/${total}`),
  status: { completed: 'Klaar', inProgress: 'Bezig', pending: 'Te doen' },
};
