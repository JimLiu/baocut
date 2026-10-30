import type { TodoMessages } from './todo-copy.ts';

export const ko: TodoMessages = {
  label: '에이전트의 할 일',
  summary: (done, total, current) => (current ? `${done}/${total} · ${current}` : `${done}/${total}`),
  status: { completed: '완료', inProgress: '진행 중', pending: '할 일' },
};
