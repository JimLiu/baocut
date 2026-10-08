import { pluralForm } from '@baocut/protocol';
import type { ServicesMessages } from './services.ts';

export const pl: ServicesMessages = {
  portRange: "Wpisz numer portu od 1024 do 65535",
  portTaken: (port, service) => `${port} jest już używany przez usługę „${service}”; wybierz inny port`,
  browser: "Przeglądarka",
  sessionMeta: (connections: number, ago: string, expires: string | null) => [connections ? pluralForm('pl', connections, { one: `${connections} połączenie`, few: `${connections} połączenia`, many: `${connections} połączeń`, other: `${connections} połączenia` }) : "Brak połączeń", `Aktywność: ${ago}`, expires ? `Wygasa o ${expires}` : null].filter(Boolean).join(' · '),
  runtime: { connected: "Połączono", incompatible: "Niezgodna wersja", disconnected: "Niepołączony" },
};
