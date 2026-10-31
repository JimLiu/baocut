import type { HarnessBotMessages } from './harness-bot.ts';

export const nl: HarnessBotMessages = {
  roleLocked: 'Dit gesprek hoort bij een Bot-kanaal of -taak. Wijzig het via de kanaal- of taakinstellingen.',
  unattendedNeedsApprovals: (p) => `${p.agent} kan niet per stap om goedkeuring vragen, dus deze stap moet worden uitgevoerd terwijl jij erbij bent.`,
};
