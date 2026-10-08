import type { ThreadMessages } from './thread-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: ThreadMessages = {
  videoTools: { videos_list: 'Listar vídeos', videos_create: 'Novo vídeo', videos_inspect: 'Ler vídeo', edits_apply: 'Editar vídeo', edits_undo: 'Desfazer edições' },
  toolTitle: (action: string, label: string) => `${action}: ${label}`,
  steps: { command: 'Executar comando', read: 'Ler arquivo', edit: 'Editar arquivo', search: 'Pesquisar', other: 'Outra ferramenta' },
  phrase: {
    command: 'executou comandos',
    read: (count: number) => pluralForm('pt-BR', count, { one: `leu ${count} arquivo`, other: `leu ${count} arquivos` }),
    edit: (count: number) => pluralForm('pt-BR', count, { one: `editou ${count} arquivo`, other: `editou ${count} arquivos` }),
    search: 'pesquisou',
    video: (count: number) => pluralForm('pt-BR', count, { one: `registrou ${count} edição de vídeo`, other: `registrou ${count} edições de vídeo` }),
    tool: 'chamou ferramentas',
  },
  summary: (phrases: readonly string[]) => { const text = phrases.join(', '); return text.charAt(0).toUpperCase() + text.slice(1); },
  thinking: 'Pensando',
  stepsFallback: 'Etapas',
};
