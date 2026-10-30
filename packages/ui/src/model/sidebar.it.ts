import type { SidebarMessages } from './sidebar.ts';
import { pluralForm } from '@baocut/protocol';

export const it: SidebarMessages = {
  status: { answer: 'In attesa della tua risposta', waiting: 'In attesa di approvazione', failed: 'Non riuscito', running: 'In corso', unread: 'Completato, non letto' },
  stopping: 'Interruzione in corso',
  count: {
    answer: (n: number) => `${n} in attesa della tua risposta`,
    waiting: (n: number) => `${n} in attesa di approvazione`,
    failed: (n: number) => pluralForm('it', n, { one: `${n} non riuscito`, other: `${n} non riusciti` }),
    running: (n: number) => `${n} in corso`,
    unread: (n: number) => pluralForm('it', n, { one: `${n} completato, non letto`, other: `${n} completati, non letti` }),
  },
};
