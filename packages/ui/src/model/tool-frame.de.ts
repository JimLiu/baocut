import type { ToolFrameMessages } from './tool-frame.ts';

export const de: ToolFrameMessages = {
  noneAvailable: (noun: string) => `Noch nichts verfügbar: ${noun}; in den Einstellungen einrichten`,
  pickOne: (noun: string) => `Zuerst auswählen: ${noun}`,
  notInstalled: (name: string) => `${name} ist noch nicht installiert`,
  notConnected: (provider: string) => `${provider} ist noch nicht verbunden`,
  unavailable: (name: string, why: string | null) => `${name} · ${why ?? "Nicht verfügbar"}`,
  notInstalledWarning: (name: string) => `${name} ist noch nicht installiert. Ein installiertes Modell auswählen oder es in den Einstellungen herunterladen`,
  notConnectedWarning: (provider: string) => `${provider} ist noch nicht verbunden. Eine funktionierende Verbindung auswählen oder den Anbieter in den Einstellungen verbinden`,
  noModel: (noun: string, local: boolean) =>
    local
      ? `Keine verfügbaren Modelle vom Typ ${noun}. In den Einstellungen ein lokales Modell installieren oder einen Cloud-Dienst verbinden.`
      : `Keine verfügbaren Modelle vom Typ ${noun}. In den Einstellungen einen Cloud-Dienst verbinden.`,
};
