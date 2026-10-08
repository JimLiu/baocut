import type { ListMessages } from './list.ts';

export const it: ListMessages = {
  join: (p) => `${p.head}; ${p.tail}`,
};
