import type { HarnessBotMessages } from './harness-bot.ts';

export const pl: HarnessBotMessages = {
  roleLocked: 'Ta rozmowa należy do kanału lub zadania Bota. Zmień ją w ustawieniach kanału lub zadania.',
  unattendedNeedsApprovals: (p) => `${p.agent} nie może prosić o zatwierdzenie krok po kroku, więc ten krok musi zostać wykonany w Twojej obecności.`,
};
