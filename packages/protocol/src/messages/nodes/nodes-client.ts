import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './nodes-client.zh-Hans.ts';
import { zhHant } from './nodes-client.zh-Hant.ts';
import { ja } from './nodes-client.ja.ts';
import { ko } from './nodes-client.ko.ts';
import { es } from './nodes-client.es.ts';
import { fr } from './nodes-client.fr.ts';
import { de } from './nodes-client.de.ts';
import { nl } from './nodes-client.nl.ts';
import { ptBR } from './nodes-client.pt-BR.ts';
import { it } from './nodes-client.it.ts';
import { ru } from './nodes-client.ru.ts';
import { pl } from './nodes-client.pl.ts';
import { tr } from './nodes-client.tr.ts';
import { vi } from './nodes-client.vi.ts';

/** 用别的电脑（节点）转写的这一端：连接、配对、已配对节点与远端任务的说明与错误（`packages/nodes/src/client`）。`label` 是节点的地址或别名。 */
const en = {
  badEventStream: (p: { label: string }) => `Node ${p.label} returned an invalid event stream response`,
  badResultResponse: (p: { label: string }) => `Node ${p.label} returned an invalid result response`,
  badJson: (p: { label: string }) => `Node ${p.label} didn't return valid JSON`,
  responseTooLarge: (p: { label: string }) => `The response from node ${p.label} is too large`,
  nodeReturnedStatus: (p: { status: number }) => `The node returned ${p.status}`,
  timedOut: (p: { label: string }) => `Node ${p.label} didn't respond in time`,
  idleTimeout: (p: { label: string }) => `The connection to node ${p.label} timed out while idle`,
  connectionFailed: (p: { label: string }) => `The connection to node ${p.label} failed`,
  connectionFailedCode: (p: { label: string; code: string }) => `The connection to node ${p.label} failed (${p.code})`,
  badStreamLine: 'The event stream has an invalid line',
  noHeartbeat: 'The event stream stopped sending heartbeats',
  streamInterrupted: 'The event stream was interrupted',
  streamInterruptedCode: (p: { code: string }) => `The event stream was interrupted (${p.code})`,
  labelVersionIncompatible: (p: { label: string }) => `Node ${p.label}'s protocol version isn't compatible with this computer`,
  badPairResponse: (p: { label: string }) => `Node ${p.label} returned an invalid pairing response`,
  pairedNodeNotFound: (p: { id: string }) => `No paired node: ${p.id}`,
  labelUnreachable: (p: { label: string }) => `Can't reach node ${p.label}`,
  pairRejected: (p: { label: string; message: string }) => `Node ${p.label} rejected pairing: ${p.message}`,
  pairFailed: (p: { label: string }) => `Pairing with node ${p.label} failed`,
  nodeLabel: (p: { alias: string }) => `Node ${p.alias}`,
  bundleLabel: (p: { bundleId: string; backend: string; device: string }) => `${p.bundleId} (${p.backend}/${p.device})`,
  tokenUnreadable: (p: { problem: string }) => `This computer can't read this node's token: ${p.problem}`,
  unreachable: "Can't reach this node",
  versionIncompatible: "The node's protocol version isn't compatible with this computer",
  pairingRevoked: 'The node no longer recognizes this pairing',
  transcribeSharingOff: 'The node turned off transcription sharing. Turn it on on that computer (baocut share capability transcribe on)',
  noTranscribeBundle: 'The node has no transcription model package ready',
  aliasTaken: (p: { alias: string }) => `Another node already uses this alias: ${p.alias}`,
  aliasLength: (p: { max: number }) => `The alias must be 1–${p.max} characters`,
  tokenNotSaved: (p: { message: string }) => `The node's token wasn't saved: ${p.message}`,
  noNodeSpecified: 'No remote node was specified',
  nodeNotPaired: 'This node is no longer in the paired list on this computer',
  tokenUnreadableDefault: "Can't read the token",
  nodeTokenUnavailable: (p: { alias: string; reason: string }) => `Node ${p.alias}'s token isn't available: ${p.reason}`,
  noToken: 'This computer has no token for this node. Pair it again',
  mediaUnreadable: "Can't read the media file",
  mediaTypeMissing: "The media file's type is missing",
  noBundle: 'No model package was specified',
  remoteTaskFailed: 'The task failed on the node',
  cancelledBySharingOff: 'The node stopped sharing and cancelled the task',
  nodeRestarted: 'The node restarted and the task was interrupted',
  completedWithoutOutput: 'The node reported the task as finished but gave no result',
  resultMismatch: "The downloaded result doesn't match the digest or length the node reported",
  badHealth: "The node's health response is invalid",
  otherNodeAtAddress: 'A different node is now at this address',
  bundleNotReady: "The model package isn't available on the node",
  capabilityDisabled: (p: { name: string }) =>
    `Node ${p.name} turned off transcription sharing. Turn it on on that computer (baocut share capability transcribe on), or transcribe on this computer or another node`,
  taskGone: 'The task no longer exists on the node',
  streamEndedEarly: 'The event stream ended before the task finished',
  reconnectFailed: (p: { label: string; seconds: number }) =>
    `Lost the connection to node ${p.label} and still couldn't reconnect after ${p.seconds} seconds`,
  retryFailed: (p: { label: string; seconds: number }) =>
    `Lost the connection to node ${p.label} and retries still failed after ${p.seconds} seconds`,
};

export type NodesClientMessages = typeof en;

export const NodesClient = defineCatalog('nodesClient', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
