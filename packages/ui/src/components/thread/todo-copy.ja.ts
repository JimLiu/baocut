import type { TodoMessages } from './todo-copy.ts';

export const ja: TodoMessages = {
  label: 'エージェントの ToDo',
  summary: (done, total, current) => (current ? `${done}/${total} · ${current}` : `${done}/${total}`),
  status: { completed: '完了', inProgress: '進行中', pending: '未着手' },
};
