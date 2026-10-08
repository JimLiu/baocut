import type { JobsSaveLocationMessages } from './save-location.ts';

export const it: JobsSaveLocationMessages = {
  notDirectory: "Non è una cartella",
  unwritable: (p: { dir: string; problem: string }) => `Impossibile scrivere nella posizione di salvataggio: ${p.dir} (${p.problem})`,
};
