import type { ListMessages } from './list.ts';

export const pl: ListMessages = {
  join: (p) => `${p.head}; ${p.tail}`,
};
