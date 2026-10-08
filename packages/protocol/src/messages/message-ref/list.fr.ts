import type { ListMessages } from './list.ts';

export const fr: ListMessages = {
  join: (p) => `${p.head} ; ${p.tail}`,
};
