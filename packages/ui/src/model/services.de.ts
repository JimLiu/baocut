import { pluralForm } from '@baocut/protocol';
import type { ServicesMessages } from './services.ts';

export const de: ServicesMessages = {
  portRange: "Portnummer zwischen 1024 und 65535 eingeben",
  portTaken: (port: number, service: string) => `${port} wird bereits verwendet von „${service}“; anderen Port auswählen`,
  browser: "Browser",
  sessionMeta: (connections: number, ago: string, expires: string | null) =>
    [connections ? `${connections} ${pluralForm('de', connections, { one: "Verbindung", other: "Verbindungen" })}` : "Keine Verbindungen", `Aktiv ${ago}`, expires ? `Läuft ab um ${expires}` : null]
      .filter(Boolean)
      .join(" · "),
  runtime: { connected: "Verbunden", incompatible: "Inkompatible Version", disconnected: "Nicht verbunden" },
};
