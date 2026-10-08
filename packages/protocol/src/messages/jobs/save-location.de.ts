import type { JobsSaveLocationMessages } from './save-location.ts';

export const de: JobsSaveLocationMessages = {
  notDirectory: "Kein Ordner",
  unwritable: (p: { dir: string; problem: string }) => `Schreiben an den Speicherort fehlgeschlagen: ${p.dir} (${p.problem})`,
};
