import type { SidebarMessages } from './sidebar.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: SidebarMessages = {
  status: { answer: 'Aguardando sua resposta', waiting: 'Aguardando aprovação', failed: 'Falhou', running: 'Em andamento', unread: 'Concluído, não lido' },
  stopping: 'Parando',
  count: {
    answer: (n: number) => `${n} aguardando sua resposta`,
    waiting: (n: number) => `${n} aguardando aprovação`,
    failed: (n: number) => `${n} com falha`,
    running: (n: number) => `${n} em andamento`,
    unread: (n: number) => pluralForm('pt-BR', n, { one: `${n} concluído, não lido`, other: `${n} concluídos, não lidos` }),
  },
};
