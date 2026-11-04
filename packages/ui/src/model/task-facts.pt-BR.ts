import type { TaskFactsMessages } from './task-facts.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: TaskFactsMessages = {
  fact: { kind: 'Tipo', submitter: 'Iniciado por', status: 'Status', startedAt: 'Iniciado', runsOn: 'Executa em', language: 'Idioma', request: 'Instruções', phase: 'Fase', images: 'Imagens', took: 'Tempo gasto', left: 'Tempo restante', cost: 'Custo' },
  imageCount: (count: number) => pluralForm('pt-BR', count, { one: `${count} imagem`, other: `${count} imagens` }),
};
