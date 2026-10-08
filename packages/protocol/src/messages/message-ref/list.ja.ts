import type { ListMessages } from './list.ts';

export const ja: ListMessages = {
  join: (p) => `${p.head}、${p.tail}`,
};
