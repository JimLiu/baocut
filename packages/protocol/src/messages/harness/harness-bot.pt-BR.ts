import type { HarnessBotMessages } from './harness-bot.ts';

export const ptBR: HarnessBotMessages = {
  roleLocked: 'Esta conversa pertence a um canal ou tarefa do Bot. Altere-a nas configurações do canal ou da tarefa.',
  unattendedNeedsApprovals: (p) => `${p.agent} não pode pedir aprovação passo a passo, então esta etapa precisa que você esteja presente para ser executada.`,
};
