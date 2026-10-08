import type { ServicesMessages } from './services.ts';
import { pluralForm } from '@baocut/protocol';

export const it: ServicesMessages = {
  portRange: 'Inserisci un numero di porta tra 1024 e 65535',
  portTaken: (port, service) => `${port} è già usata da «${service}»; scegli un’altra porta`,
  browser: 'Browser',
  sessionMeta: (connections, ago, expires) => `${connections ? pluralForm('it', connections, { one: `${connections} connessione`, other: `${connections} connessioni` }) : 'Nessuna connessione'} · Attivo ${ago}${expires ? ` · Scade alle ${expires}` : ''}`,
  runtime: { connected: 'Connesso', incompatible: 'Versione incompatibile', disconnected: 'Non connesso' },
};
