import type { ListMessages } from './list.ts';

export const zhHans: ListMessages = {
  join: (p) => `${p.head}；${p.tail}`,
};
