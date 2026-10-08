import type { JobsSaveLocationMessages } from './save-location.ts';

export const ru: JobsSaveLocationMessages = {
  notDirectory: 'Это не папка',
  unwritable: (p: { dir: string; problem: string }) => `Невозможно записать в место сохранения: ${p.dir} (${p.problem})`,
};
