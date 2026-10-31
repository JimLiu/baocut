import type { HarnessBotMessages } from './harness-bot.ts';

export const fr: HarnessBotMessages = {
  roleLocked: 'Cette conversation appartient à un canal ou à une tâche du Bot. Modifiez-la depuis les réglages du canal ou de la tâche.',
  unattendedNeedsApprovals: (p) => `${p.agent} ne peut pas demander d'approbation étape par étape : cette étape doit s'exécuter en votre présence.`,
};
