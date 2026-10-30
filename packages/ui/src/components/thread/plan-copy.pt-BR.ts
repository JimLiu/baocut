import type { PlanMessages } from './plan-copy.ts';

export const ptBR: PlanMessages = {
  title: 'O agente tem um plano para você aprovar',
  modeLabel: 'Modo de acesso ao implementar',
  implement: 'Implementar o plano',
  keepPlanning: 'Continuar planejando',
  hint: 'Ou diga ao agente o que mudar na caixa de mensagem.',
  kind: 'Plano',
  approved: (mode) => `Aprovado · implementando em ${mode}`,
  declined: 'Não aprovado',
  byMessage: 'Respondido em uma mensagem',
  cancelled: 'Interrompido',
  rowLead: 'O plano está bom?',
  followUp: 'Implemente o plano acima.',
  failed: (message) => `Não foi possível enviar: ${message}`,
};
