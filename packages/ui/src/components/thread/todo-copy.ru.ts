import type { TodoMessages } from './todo-copy.ts';

export const ru: TodoMessages = {
  label: 'Список дел агента',
  summary: (done, total, current) => (current ? `${done}/${total} · ${current}` : `${done}/${total}`),
  status: { completed: 'Готово', inProgress: 'В работе', pending: 'Предстоит' },
};
