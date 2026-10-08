import type { ListMessages } from './list.ts';

export const ptBR: ListMessages = {
  join: (p) => `${p.head}; ${p.tail}`,
};
