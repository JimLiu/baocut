import type { ClientConnectionMessages } from './client-connection.ts';

export const it: ClientConnectionMessages = {
  closed: "Il client è chiuso",
  disconnected: "La connessione al Runtime è stata persa",
  connectionLost: "Connessione persa",
  cannotConnect: "Impossibile connettersi al Runtime",
  requestTimedOut: (p) => `Richiesta scaduta: ${p.method}`,
  unknownError: "Errore sconosciuto",
};
