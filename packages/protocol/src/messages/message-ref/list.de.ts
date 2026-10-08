type P<K extends string> = Record<K, string | number>;
import type { ListMessages } from './list.ts';

export const de: ListMessages = {
  join: (p: P<'head' | 'tail'>) => `${p.head}; ${p.tail}`,
};
