import type { HarnessBotMessages } from './harness-bot.ts';

export const de: HarnessBotMessages = {
  roleLocked: 'Diese Unterhaltung gehört zu einem Bot-Kanal oder einer Bot-Aufgabe. Ändere sie in den Kanal- oder Aufgabeneinstellungen.',
  unattendedNeedsApprovals: (p) => `${p.agent} kann nicht schrittweise um Freigabe bitten, daher muss dieser Schritt in deinem Beisein laufen.`,
};
