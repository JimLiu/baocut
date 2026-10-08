import type { ToolFrameMessages } from './tool-frame.ts';

export const nl: ToolFrameMessages = {
  noneAvailable: (noun: string) => `Nog niets beschikbaar: ${noun}; stel dit in bij Instellingen`,
  pickOne: (noun: string) => `Kies eerst: ${noun}`,
  notInstalled: (name: string) => `${name} is nog niet geïnstalleerd`,
  notConnected: (provider: string) => `${provider} is nog niet verbonden`,
  unavailable: (name: string, why: string | null) => `${name} · ${why ?? "Niet beschikbaar"}`,
  notInstalledWarning: (name: string) => `${name} is nog niet geïnstalleerd. Kies een geïnstalleerd model of download het bij Instellingen`,
  notConnectedWarning: (provider: string) => `${provider} is nog niet verbonden. Kies een werkende verbinding of verbind de aanbieder bij Instellingen`,
  noModel: (noun: string, local: boolean) =>
    local
      ? `Geen beschikbaar model van het type ${noun}. Installeer een lokaal model of verbind een clouddienst bij Instellingen.`
      : `Geen beschikbaar model van het type ${noun}. Verbind een clouddienst bij Instellingen.`,
};
