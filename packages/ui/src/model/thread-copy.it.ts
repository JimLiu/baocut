import type { ThreadMessages } from './thread-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: ThreadMessages = {
  videoTools: { videos_list: 'Elenca video', videos_create: 'Nuovo video', videos_inspect: 'Leggi video', edits_apply: 'Modifica video', edits_undo: 'Annulla le modifiche' },
  toolTitle: (action: string, label: string) => `${action}: ${label}`,
  steps: { command: 'Esegui comando', read: 'Leggi file', edit: 'Modifica file', search: 'Cerca', other: 'Altro strumento' },
  phrase: {
    command: 'ha eseguito comandi',
    read: (count: number) => `ha letto ${count} file`,
    edit: (count: number) => `ha modificato ${count} file`,
    search: 'ha cercato',
    video: (count: number) => pluralForm('it', count, { one: `ha registrato ${count} modifica video`, other: `ha registrato ${count} modifiche video` }),
    tool: 'ha chiamato strumenti',
  },
  summary: (phrases: readonly string[]) => { const text = phrases.join(', '); return text.charAt(0).toUpperCase() + text.slice(1); },
  thinking: 'Ragionamento',
  stepsFallback: 'Passaggi',
};
