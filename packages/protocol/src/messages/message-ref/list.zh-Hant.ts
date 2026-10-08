import type { ListMessages } from './list.ts';

export const zhHant: ListMessages = {
  join: (p) => `${p.head}；${p.tail}`,
};
