import type { ListMessages } from './list.ts';

export const vi: ListMessages = {
  join: (p) => `${p.head}; ${p.tail}`,
};
