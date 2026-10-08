import type { ClientConnectionMessages } from './client-connection.ts';

export const nl: ClientConnectionMessages = {
  closed: "De client is gesloten",
  disconnected: "De verbinding met de Runtime is verbroken",
  connectionLost: "Verbinding verbroken",
  cannotConnect: "Kan niet verbinden met de Runtime",
  requestTimedOut: (p: { method: string }) => `Verzoek verlopen: ${p.method}`,
  unknownError: "Onbekende fout",
};
