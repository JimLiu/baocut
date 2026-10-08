import type { ListMessages } from './list.ts';

export const ko: ListMessages = {
  join: (p) => `${p.head}; ${p.tail}`,
};
