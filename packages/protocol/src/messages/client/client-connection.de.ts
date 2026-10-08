import type { ClientConnectionMessages } from './client-connection.ts';

export const de: ClientConnectionMessages = {
  closed: "Der Client ist geschlossen",
  disconnected: "Die Verbindung zur Runtime wurde unterbrochen",
  connectionLost: "Verbindung unterbrochen",
  cannotConnect: "Verbindung zur Runtime nicht möglich",
  requestTimedOut: (p: { method: string }) => `Zeitüberschreitung bei Anfrage: ${p.method}`,
  unknownError: "Unbekannter Fehler",
};
