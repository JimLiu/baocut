import type { ListMessages } from './list.ts';

export const tr: ListMessages = {
  join: (p) => `${p.head}; ${p.tail}`,
};
