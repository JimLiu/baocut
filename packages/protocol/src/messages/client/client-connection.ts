import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './client-connection.zh-Hans.ts';
import { zhHant } from './client-connection.zh-Hant.ts';
import { ja } from './client-connection.ja.ts';
import { ko } from './client-connection.ko.ts';
import { es } from './client-connection.es.ts';
import { fr } from './client-connection.fr.ts';
import { de } from './client-connection.de.ts';
import { nl } from './client-connection.nl.ts';
import { ptBR } from './client-connection.pt-BR.ts';
import { it } from './client-connection.it.ts';
import { ru } from './client-connection.ru.ts';
import { pl } from './client-connection.pl.ts';
import { tr } from './client-connection.tr.ts';
import { vi } from './client-connection.vi.ts';

/** 客户端与 Runtime 连接的错误与断开原因（`packages/client`）。 */
const en = {
  closed: 'The client is closed',
  disconnected: 'The connection to the Runtime was lost',
  connectionLost: 'Connection lost',
  cannotConnect: "Can't connect to the Runtime",
  requestTimedOut: (p: { method: string }) => `Request timed out: ${p.method}`,
  unknownError: 'Unknown error',
};

export type ClientConnectionMessages = typeof en;

export const ClientConnection = defineCatalog('clientConnection', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
