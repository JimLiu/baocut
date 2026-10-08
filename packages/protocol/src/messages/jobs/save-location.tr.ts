import type { JobsSaveLocationMessages } from './save-location.ts';

export const tr: JobsSaveLocationMessages = {
  notDirectory: 'Klasör değil',
  unwritable: (p: { dir: string; problem: string }) => `Kaydetme konumuna yazılamıyor: ${p.dir} (${p.problem})`,
};
