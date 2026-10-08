import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './nodes-server.zh-Hans.ts';
import { zhHant } from './nodes-server.zh-Hant.ts';
import { ja } from './nodes-server.ja.ts';
import { ko } from './nodes-server.ko.ts';
import { es } from './nodes-server.es.ts';
import { fr } from './nodes-server.fr.ts';
import { de } from './nodes-server.de.ts';
import { nl } from './nodes-server.nl.ts';
import { ptBR } from './nodes-server.pt-BR.ts';
import { it } from './nodes-server.it.ts';
import { ru } from './nodes-server.ru.ts';
import { pl } from './nodes-server.pl.ts';
import { tr } from './nodes-server.tr.ts';
import { vi } from './nodes-server.vi.ts';

/** 共享给别的电脑的这一端（节点服务）：HTTP 接口、远端任务与共享开关的错误说明（`packages/nodes/src`）。经节点协议回给对方时按本机语言。 */
const en = {
  taskRequestInvalid: 'Invalid task request',
  transcribeNotShared: "The node doesn't share transcription",
  bundleNotReady: "The model package isn't available on the node",
  inputTooLarge: "The media exceeds the node's limit",
  diskLow: 'The node is low on disk space',
  uploadExpired: "The upload wasn't finished in time after the task was created",
  notAwaitingUpload: "The task isn't waiting for an upload",
  lengthMismatch: "The uploaded length doesn't match the declared length",
  noLongerAwaitingUpload: 'The task is no longer waiting for an upload',
  digestMismatch: "The uploaded content doesn't match the declared digest",
  digestOrLengthMismatch: "The uploaded content doesn't match the declared digest or length",
  notAccepted: "The node couldn't accept this task",
  resultDeleted: 'The result was deleted',
  taskNotFound: "The task doesn't exist",
  taskNotCompleted: "The task hasn't finished",
  idempotencyConflict: 'Same clientJobId but different request content',
  queueFull: 'This client has reached its task limit',
  completedWithoutResult: 'The task finished without a result',
  sourceNotAllowed: "The source address isn't allowed",
  protocolTooOld: 'The protocol version is too old or missing',
  pairRequestInvalid: 'Invalid pairing request',
  tokenInvalid: 'The token is invalid or revoked',
  noEndpoint: 'No such endpoint',
  methodNotAllowed: "This endpoint doesn't support this method",
  contentLengthRequired: 'Uploads must include Content-Length',
  badUrl: 'Invalid request URL',
  requestFailed: 'Request handling failed',
  bodyTooLarge: 'The request body exceeds 64 KiB',
  bodyNotJson: "The request body isn't valid JSON",
  sinceInvalid: 'since must be a non-negative integer',
  runtimeStopping: 'Runtime is stopping',
  sharingOff: "Sharing isn't on",
  clientNotFound: 'No such client',
  listSeparator: ', ',
  capabilityNotShareable: (p: { capability: string; shareable: string }) =>
    `The node can't share this capability: ${p.capability} (shareable: ${p.shareable})`,
  pairingLocked: 'Pairing is locked',
  pairingCodeInvalid: 'The pairing code is wrong, expired, or missing',
  portInUse: (p: { port: number }) => `Port ${p.port} is already in use`,
  shareFileUnreadable: (p: { reason: string }) => `The sharing settings file (node-share.json) can't be read (${p.reason}). It was left untouched; fix or remove it to change sharing`,
  cannotListen: (p: { code: string }) => `The node service can't listen: ${p.code}`,
};

export type NodesServerMessages = typeof en;

export const NodesServer = defineCatalog('nodesServer', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
