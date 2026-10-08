import type { ClientConnectionMessages } from './client-connection.ts';

export const pl: ClientConnectionMessages = {
  closed: 'Klient jest zamknięty',
  disconnected: 'Utracono połączenie z Runtime',
  connectionLost: 'Utracono połączenie',
  cannotConnect: 'Nie można połączyć się z Runtime',
  requestTimedOut: (p) => `Upłynął limit czasu żądania: ${p.method}`,
  unknownError: 'Nieznany błąd',
};
