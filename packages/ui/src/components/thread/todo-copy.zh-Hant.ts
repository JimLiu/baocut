import type { TodoMessages } from './todo-copy.ts';

export const zhHant: TodoMessages = {
  label: 'Agent 的待辦',
  summary: (done, total, current) => (current ? `${done}/${total} · ${current}` : `${done}/${total}`),
  status: { completed: '已完成', inProgress: '進行中', pending: '待辦' },
};
