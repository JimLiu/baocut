import type { HarnessBotMessages } from './harness-bot.ts';

export const ru: HarnessBotMessages = {
  roleLocked: 'Этот разговор относится к каналу или задаче Bot. Измените его в настройках канала или задачи.',
  unattendedNeedsApprovals: (p) => `${p.agent} не умеет запрашивать подтверждение по шагам, поэтому этот шаг нужно выполнять при вас.`,
};
