import type { TodoMessages } from './todo-copy.ts';

export const tr: TodoMessages = {
  label: 'Ajanın yapılacaklar listesi',
  summary: (done, total, current) => (current ? `${done}/${total} · ${current}` : `${done}/${total}`),
  status: { completed: 'Bitti', inProgress: 'Sürüyor', pending: 'Yapılacak' },
};
