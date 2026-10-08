import type { JobsSaveLocationMessages } from './save-location.ts';

export const pl: JobsSaveLocationMessages = {
  notDirectory: 'To nie folder',
  unwritable: (p: { dir: string; problem: string }) => `Nie można zapisać w lokalizacji: ${p.dir} (${p.problem})`,
};
