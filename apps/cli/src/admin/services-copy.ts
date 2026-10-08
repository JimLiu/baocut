import {
  MCP_DEFAULT_PORT,
  MODEL_API_DEFAULT_PORT,
  WEB_DEFAULT_PORT,
  defineMessages,
  type ServiceLevel,
  type ServiceStatus,
} from '@baocut/protocol';
import { zhHans } from './services-copy.zh-Hans.ts';
import { zhHant } from './services-copy.zh-Hant.ts';
import { ja } from './services-copy.ja.ts';
import { ko } from './services-copy.ko.ts';
import { es } from './services-copy.es.ts';
import { fr } from './services-copy.fr.ts';
import { de } from './services-copy.de.ts';
import { nl } from './services-copy.nl.ts';
import { ptBR } from './services-copy.pt-BR.ts';
import { it } from './services-copy.it.ts';
import { ru } from './services-copy.ru.ts';
import { pl } from './services-copy.pl.ts';
import { tr } from './services-copy.tr.ts';
import { vi } from './services-copy.vi.ts';

const s = (n: number) => (n === 1 ? '' : 's');

/** `baocut services` 与 `baocut web` 的文案（英文是键与类型的来源，译文在 `services-copy.<语言>.ts`）。 */
const en = {
  accessLinkVideo: (video: string) => `After signing in, the editor for video ${video} opens directly`,

  /** `baocut services --help` 与 `baocut help services` 的正文。 */
  help: `Usage:
  baocut services [status]         External services: status, address, level, and scope of the
                                   MCP service, model API service, web service, and LAN node
  baocut services start <service>  Start a service (mcp, model-api, web, node)
  baocut services stop <service>   Stop a service (disconnects external connections and cancels
                                   requests awaiting confirmation; submitted tasks run to completion)
  baocut services configure <service> [options]
    --port <port>                  Listening port (loopback address only; MCP defaults to ${MCP_DEFAULT_PORT}, the model API to
                                   ${MODEL_API_DEFAULT_PORT}); if it's taken, the service reports an error instead of switching ports
    --level read|ask|auto          read is read-only; ask has you confirm each write, task,
                                   and generation in BaoCut (default); auto runs them directly
    --videos all|<id,…>            Expose all videos, or only these videoIds (comma-separated); videos outside
                                   the scope aren't visible externally (the model API service has no scope)
    --autostart on|off             Start with the Runtime
    --route-online on|off          Model API service: forward requests to enabled online services (default off, local models only)
    --route-nodes on|off           Model API service: forward to paired LAN nodes (default off)
    --route-agent on|off           Model API service: forward to agent providers (default off)
    --max-concurrent <n>           Model API service: in-flight requests per client (default 4); requests over the limit get 429
    --read-only on|off             web only: the browser can only view, not edit, send messages, or submit tasks
    --methods default|<method,…>   web only: method allowlist (method names or <namespace>.*), can only narrow the default set
  baocut services mcp add-client <name>
                                   Create a token for an external app (shown only
                                   this once); one per app, each revocable on its own
  baocut services mcp clients      List created clients (tokens not included)
  baocut services mcp revoke <clientId>
                                   Revoke a client; its token stops working immediately
  baocut services mcp connection [clientId]
                                   Print the address and a snippet to paste into an MCP
                                   client's configuration (with a placeholder for the token)
  baocut services model-api add-client|clients|revoke|connection …
                                   Clients of the model API service (a local OpenAI-style endpoint),
                                   used as above; its tokens and MCP tokens aren't interchangeable;
                                   connection prints how to set OPENAI_BASE_URL and OPENAI_API_KEY
  baocut services model-api aliases
                                   List model name aliases (by default whisper-1 → the local default transcription model)
  baocut services model-api alias <name> <capability> <providerId>[/<modelId>]
                                   Add or change an alias; without a model, the provider's default model is used
  baocut services model-api unalias <name>
                                   Delete an alias
  baocut services web sessions     List browser sessions (session tokens not included)
  baocut services web revoke <sessionId>
                                   Revoke a browser session: its connection drops immediately`,
  /** `baocut web --help` 的正文。 */
  webHelp: `Usage:
  baocut web open [--video <videoId>] [--launch]       Start the web service (default port ${WEB_DEFAULT_PORT}) and print a one-time access link; the link works
                                   only once, for two minutes. --video opens that video directly in the editor (videoId comes from
                                   baocut videos list). --launch opens a sign-in page without the code in the default
                                   browser; the access code is printed only in the terminal, for you to paste into the sign-in
                                   page (the code isn't passed in the arguments of the command that opens the browser)`,
  usage:
    'Usage: baocut services [status | start <service> | stop <service>\n' +
    '       | configure <service> [--port <n>] [--level read|ask|auto] [--videos all|<id,…>] [--autostart on|off]\n' +
    '                    [--route-online on|off] [--route-nodes on|off] [--route-agent on|off] [--max-concurrent <n>]\n' +
    '                    [--read-only on|off] [--methods default|<method,…>]\n' +
    '       | mcp|model-api add-client <name> | mcp|model-api clients | mcp|model-api revoke <clientId>\n' +
    '       | mcp|model-api connection [clientId]\n' +
    '       | model-api aliases | model-api alias <name> <capability> <providerId>[/<modelId>] | model-api unalias <name>\n' +
    '       | web sessions | web revoke <sessionId>]',
  unknownService: (id: string, available: readonly string[]) => `Unknown service: ${id}. Available: ${available.join(', ')}`,
  addClientUsage: (service: 'mcp' | 'model-api') =>
    `Usage: baocut services ${service} add-client <name> (pick a name you'll recognize, e.g. ${service === 'mcp' ? 'Claude Desktop' : 'Subtitle Tool'})`,
  aliasUsage: (capabilities: readonly string[]) =>
    `Usage: baocut services model-api alias <name> <capability> <providerId>[/<modelId>] (capabilities: ${capabilities.join(', ')})`,
  unknownCapability: (capability: string, available: readonly string[]) =>
    `Unknown capability: ${capability}. Available: ${available.join(', ')}`,
  onOff: (flag: string) => `${flag} must be on or off`,
  portRange: '--port must be an integer from 1 to 65535',
  levelChoice: (levels: readonly string[]) => `--level must be one of: ${levels.join(', ')}`,
  videosFormat: '--videos must be all, or comma-separated video IDs',
  maxConcurrentRange: '--max-concurrent must be an integer from 1 to 64',
  routingOnlyModelApi: '--route-online, --route-nodes, --route-agent and --max-concurrent only apply to model-api',
  methodsFormat: '--methods must be default, or comma-separated method names and <namespace>.*',
  webOnlyFlags: '--read-only and --methods only apply to the web service',
  nothingToConfigure:
    'Nothing to change: give --port, --level, --videos, --autostart, model-api routing and concurrency, or --read-only and --methods for web',
  states: {
    off: 'Off',
    starting: 'Starting',
    on: 'On',
    stopping: 'Stopping',
    error: 'Error',
  } satisfies Record<ServiceStatus['state'], string>,
  levels: {
    read: 'read (read-only)',
    ask: 'ask (confirm each write)',
    auto: 'auto (run directly)',
  } satisfies Record<ServiceLevel, string>,
  levelAskModelApi: 'ask (confirm each generation request)',
  notProvided: (serviceId: string, label: string) => `${serviceId}  ${label}  Not available in this version`,
  port: (port: number) => `port ${port}`,
  reason: (error: string) => `  Reason: ${error}`,
  nodeHint: '  Use baocut share for the port, capabilities and pairing',
  autostart: (on: boolean) => `  Start with Runtime: ${on ? 'yes' : 'no'}`,
  level: (level: string) => `  Level: ${level}`,
  levelScope: (level: string, scope: string) => `  Level: ${level}  Scope: ${scope}`,
  allVideos: 'all videos',
  someVideos: (ids: readonly string[]) => `${ids.length} video${s(ids.length)} (${ids.join(', ')})`,
  routeLocal: 'this computer',
  routeOnline: 'online services',
  routeNodes: 'LAN nodes',
  routeAgent: 'agent',
  routing: (routes: readonly string[], maxConcurrent: number) =>
    `  Routes to: ${routes.join(', ')}  ${maxConcurrent} concurrent request${s(maxConcurrent)} per client`,
  aliases: (aliases: readonly string[]) => `  Aliases: ${aliases.length > 0 ? aliases.join(', ') : 'none'}`,
  clientCount: (count: number) => `  Clients: ${count}`,
  web: (readOnly: boolean, methods: readonly string[] | null) =>
    `  Read-only: ${readOnly ? 'yes' : 'no'}  Allowed methods: ${methods === null ? 'default set' : methods.join(', ')}`,
  browserSessions: (count: number) => `  Browser sessions: ${count} (access link: baocut web open)`,
  aliasTarget: (alias: string, providerId: string, modelId: string | null, capability: string) =>
    `${alias} → ${providerId}/${modelId ?? 'default model'} (${capability})`,
  noAliases: 'No aliases. Add one with baocut services model-api alias <name> <capability> <providerId>[/<modelId>]',
  noClients: (service: string) => `No clients. Create one with baocut services ${service} add-client <name>`,
  client: (clientId: string, name: string, createdAt: string, lastUsedAt: string | null) =>
    `${clientId}  ${name}  created ${createdAt}  last used ${lastUsedAt ?? 'never'}`,
  clientCreated: (name: string, clientId: string) => `Created client ${name} (${clientId})`,
  tokenOnce: (token: string) =>
    `Token (shown only this once; copy and save it now. If you lose it, revoke the client and create a new one): ${token}`,
  address: (url: string) => `URL: ${url}`,
  bearerHeader: 'Header: Authorization: Bearer <token>',
  header: (value: string) => `Header: Authorization: ${value}`,
  interfaceVersion: (version: string) => `Interface version: ${version}`,
  snippetIntro: 'Config snippet (replace the token placeholder with the token you got when creating the client):',
  noWebSessions: 'No browser sessions. Get an access link with baocut web open',
  webSession: (sessionId: string, createdAt: string, lastUsedAt: string, expiresAt: string, connections: number) =>
    `${sessionId}  signed in ${createdAt}  last used ${lastUsedAt}  expires ${expiresAt}  ${connections} connection${s(connections)}`,
  accessLinkNote: (expiresAt: string) =>
    `This link works once and is valid until ${expiresAt}; don't share it. Once it's used or expired, run baocut web open again`,
  badAccessLink: "The access link isn't in the expected format: update BaoCut, or run again without --launch",
  accessCode: (code: string) => `Access code: ${code}`,
  launchNote: (loginUrl: string, expiresAt: string) =>
    `Paste this code into the sign-in page that opened in your browser (${loginUrl}). The code works once and is valid until ${expiresAt}; don't share it. Once it's used or expired, run baocut web open again`,
  webNotStarted: (reason: string) => `The web service didn't start: ${reason}`,
  serviceError: (serviceId: string, reason: string) => `${serviceId} failed: ${reason}`,
  clientRevoked: (clientId: string) => `Revoked ${clientId}; its token stops working immediately`,
  webSessionRevoked: (sessionId: string) => `Revoked ${sessionId}; its connection was closed`,
  browserFailed: (message: string) => `Couldn't open the browser: ${message}. Open the sign-in page above yourself`,
};

export type ServicesMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
