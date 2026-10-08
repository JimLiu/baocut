import type { JobsSaveLocationMessages } from './save-location.ts';

export const ptBR: JobsSaveLocationMessages = {
  notDirectory: "Não é uma pasta",
  unwritable: (p: { dir: string; problem: string }) => `Não é possível gravar no local de salvamento: ${p.dir} (${p.problem})`,
};
