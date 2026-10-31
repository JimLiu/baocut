import type { HarnessBotMessages } from './harness-bot.ts';

export const it: HarnessBotMessages = {
  roleLocked: "Questa conversazione appartiene a un canale o a un'attività del Bot. Modificala dalle impostazioni del canale o dell'attività.",
  unattendedNeedsApprovals: (p) => `${p.agent} non può chiedere l'approvazione passo per passo, quindi questo passaggio deve essere eseguito in tua presenza.`,
};
