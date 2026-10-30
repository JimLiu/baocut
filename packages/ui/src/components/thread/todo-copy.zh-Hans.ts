import type { TodoMessages } from './todo-copy.ts';

export const zhHans: TodoMessages = {
  label: 'Agent 的待办',
  summary: (done, total, current) => (current ? `${done}/${total} · ${current}` : `${done}/${total}`),
  status: { completed: '已完成', inProgress: '进行中', pending: '待做' },
};
