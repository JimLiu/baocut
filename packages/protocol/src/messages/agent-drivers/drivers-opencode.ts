import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './drivers-opencode.zh-Hans.ts';
import { zhHant } from './drivers-opencode.zh-Hant.ts';
import { ja } from './drivers-opencode.ja.ts';
import { ko } from './drivers-opencode.ko.ts';
import { es } from './drivers-opencode.es.ts';
import { fr } from './drivers-opencode.fr.ts';
import { de } from './drivers-opencode.de.ts';
import { nl } from './drivers-opencode.nl.ts';
import { ptBR } from './drivers-opencode.pt-BR.ts';
import { it } from './drivers-opencode.it.ts';
import { ru } from './drivers-opencode.ru.ts';
import { pl } from './drivers-opencode.pl.ts';
import { tr } from './drivers-opencode.tr.ts';
import { vi } from './drivers-opencode.vi.ts';

/** OpenCode Driver：预设说明、探测结果、`opencode serve` 与会话的提示和错误。`name` 是 Agent 的名字（OpenCode）。 */
const en = {
  plan: 'Model accounts in OpenCode',
  installHint: 'Install 2.x with npm install -g @opencode/cli',
  unsupportedMajor: (p: { version: string }) =>
    `OpenCode ${p.version} is a major version BaoCut doesn't support yet. Only 2.x is supported.`,
  tooOld: (p: { version: string; min: string; command: string }) =>
    `OpenCode ${p.version} is too old. Upgrade it: BaoCut needs ${p.min} or a later 2.x (${p.command}).`,
  unsupportedVersion: (p: { version: string; min: string }) => `OpenCode ${p.version} isn't supported. It needs ${p.min} or a later 2.x`,
  versionUnknown: 'unknown version',
  noModelAccount: (p: { command: string }) =>
    `No model account is connected in OpenCode yet, so only OpenCode Zen's free models are available. Run ${p.command} in a terminal to connect one.`,
  probeFailed: (p: { error: string }) => `OpenCode serve couldn't start or read the model list: ${p.error}`,
  externalDirectory: 'Access a location outside the working directory',
  directoryNotReady: (p: { seconds: string; directory: string }) =>
    `OpenCode didn't get the directory ${p.directory} ready within ${p.seconds} seconds`,
  /** `tag`、`detail` 为空时不带。 */
  httpFailed: (p: { operation: string; status: string; tag: string; detail: string }) =>
    `OpenCode ${p.operation} failed (HTTP ${p.status}${p.tag ? ` ${p.tag}` : ''})${p.detail ? `: ${p.detail}` : ''}`,
  htmlResponse: 'Got a web page instead of the v2 API (incompatible version?)',
  processExited: 'The OpenCode process has exited',
  killedBySignal: (p: { signal: string }) => `Ended by signal ${p.signal}`,
  exitCode: (p: { code: string }) => `Exit code ${p.code}`,
  serveNotReady: (p: { seconds: string }) => `opencode serve wasn't ready within ${p.seconds} seconds`,
  serveExitedAtStart: (p: { reason: string }) => `opencode serve exited during startup (${p.reason})`,
  serveExited: 'opencode serve exited',
  streamConnectFailed: (p: { status: string }) => `Couldn't connect to the event stream (HTTP ${p.status})`,
  streamEnded: 'The event stream ended',
  streamNotConnected: (p: { seconds: string }) => `The event stream didn't connect (${p.seconds} seconds)`,
  streamLost: (p: { error: string }) => `Event stream disconnected: ${p.error}`,
  mcpFailed: (p: { name: string; server: string; error: string }) =>
    `${p.name} couldn't connect to the MCP server ${p.server} (${p.error}). BaoCut's tools aren't available in this session.`,
  mcpTimeout: (p: { name: string; servers: string }) =>
    `${p.name} didn't connect to the MCP servers (${p.servers}) in time. BaoCut's tools may not be available in this session.`,
  promptRejected: (p: { name: string; error: string }) => `${p.name} didn't accept this message: ${p.error}`,
  setModeFailed: (p: { name: string; error: string }) => `${p.name} couldn't set the access mode: ${p.error}`,
  retryFallback: 'The model request failed. Retrying shortly.',
  runFailed: (p: { name: string }) => `${p.name} run failed`,
  endedAfterRejection: (p: { name: string }) =>
    `${p.name} ended this turn after a tool was rejected. Send another message if you want it to try a different approach.`,
  interruptedTurn: (p: { name: string; reason: string }) => `${p.name} interrupted this turn (${p.reason}).`,
  modelFormat: (p: { name: string; id: string }) => `${p.name} models must be written as provider/model (got ${p.id})`,
};

export type DriversOpencodeMessages = typeof en;

export const DriversOpencode = defineCatalog('driversOpencode', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
