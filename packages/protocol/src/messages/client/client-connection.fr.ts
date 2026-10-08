import type { ClientConnectionMessages } from './client-connection.ts';

export const fr: ClientConnectionMessages = {
  closed: "Le client est fermé",
  disconnected: "La connexion au Runtime a été perdue",
  connectionLost: "Connexion perdue",
  cannotConnect: "Impossible de se connecter au Runtime",
  requestTimedOut: (p: { method: string }) => `Délai de requête dépassé : ${p.method}`,
  unknownError: "Erreur inconnue",
};
