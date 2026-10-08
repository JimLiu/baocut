import type { ListMessages } from './list.ts';

export const ru: ListMessages = {
  join: (p) => `${p.head}; ${p.tail}`,
};
