import type { JobsSaveLocationMessages } from './save-location.ts';

export const nl: JobsSaveLocationMessages = {
  notDirectory: "Geen map",
  unwritable: (p: { dir: string; problem: string }) => `Kan niet naar de opslaglocatie schrijven: ${p.dir} (${p.problem})`,
};
