import type { JobsSaveLocationMessages } from './save-location.ts';

export const fr: JobsSaveLocationMessages = {
  notDirectory: "Pas un dossier",
  unwritable: (p: { dir: string; problem: string }) => `Impossible d’écrire à l’emplacement de sauvegarde : ${p.dir} (${p.problem})`,
};
