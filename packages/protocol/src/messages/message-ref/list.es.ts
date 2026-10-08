import type { ListMessages } from './list.ts';
export const es: ListMessages = { join: (p) => `${p.head}; ${p.tail}` };
