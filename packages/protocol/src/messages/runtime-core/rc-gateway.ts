import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-gateway.zh-Hans.ts';
import { zhHant } from './rc-gateway.zh-Hant.ts';
import { ja } from './rc-gateway.ja.ts';
import { ko } from './rc-gateway.ko.ts';
import { es } from './rc-gateway.es.ts';
import { fr } from './rc-gateway.fr.ts';
import { de } from './rc-gateway.de.ts';
import { nl } from './rc-gateway.nl.ts';
import { ptBR } from './rc-gateway.pt-BR.ts';
import { it } from './rc-gateway.it.ts';
import { ru } from './rc-gateway.ru.ts';
import { pl } from './rc-gateway.pl.ts';
import { tr } from './rc-gateway.tr.ts';
import { vi } from './rc-gateway.vi.ts';

/** 本机网关（gateway.ts）的错误。英文是键与类型的来源，译文在 `rc-gateway.<语言>.ts`。 */
const en = {
  helloTimeout: 'Handshake timed out',
  textFramesOnly: 'Only text frames are accepted',
  frameNotJson: 'The frame is not valid JSON',
  frameUnrecognized: 'Unrecognized frame',
  unknownMethod: (p: { method: string }) => `Unknown method: ${p.method}`,
  invalidParams: 'Invalid parameters',
  helloRequired: 'The first frame must be hello',
  invalidToken: 'Invalid token',
  protocolMismatch: (p: { client: string; runtime: string }) =>
    `Incompatible protocol versions: client ${p.client}, Runtime ${p.runtime}`,
  internalError: 'Internal error',
  catalogLocalOnly: 'The tool catalog is only available to the local CLI and the desktop app',
};

export type RcGatewayMessages = typeof en;

export const RcGateway = defineCatalog('rcGateway', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
