import type { TodoMessages } from './todo-copy.ts';

export const vi: TodoMessages = {
  label: 'Việc cần làm của Agent',
  summary: (done, total, current) => (current ? `${done}/${total} · ${current}` : `${done}/${total}`),
  status: { completed: 'Xong', inProgress: 'Đang làm', pending: 'Chưa làm' },
};
