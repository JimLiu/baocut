import { defineMessages } from '@baocut/protocol';
import { approvalCardZh, clientsZh, commonZh, mcpZh, modelApiZh, webZh } from './services-copy.zh-Hans.ts';
import { approvalCardZhHant, clientsZhHant, commonZhHant, mcpZhHant, modelApiZhHant, webZhHant } from './services-copy.zh-Hant.ts';
import { approvalCardJa, clientsJa, commonJa, mcpJa, modelApiJa, webJa } from './services-copy.ja.ts';
import { approvalCardKo, clientsKo, commonKo, mcpKo, modelApiKo, webKo } from './services-copy.ko.ts';
import { approvalCardEs, clientsEs, commonEs, mcpEs, modelApiEs, webEs } from './services-copy.es.ts';
import { approvalCardFr, clientsFr, commonFr, mcpFr, modelApiFr, webFr } from './services-copy.fr.ts';
import { approvalCardDe, clientsDe, commonDe, mcpDe, modelApiDe, webDe } from './services-copy.de.ts';
import { approvalCardNl, clientsNl, commonNl, mcpNl, modelApiNl, webNl } from './services-copy.nl.ts';
import { approvalCardPtBR, clientsPtBR, commonPtBR, mcpPtBR, modelApiPtBR, webPtBR } from './services-copy.pt-BR.ts';
import { approvalCardIt, clientsIt, commonIt, mcpIt, modelApiIt, webIt } from './services-copy.it.ts';
import { approvalCardRu, clientsRu, commonRu, mcpRu, modelApiRu, webRu } from './services-copy.ru.ts';
import { approvalCardPl, clientsPl, commonPl, mcpPl, modelApiPl, webPl } from './services-copy.pl.ts';
import { approvalCardTr, clientsTr, commonTr, mcpTr, modelApiTr, webTr } from './services-copy.tr.ts';
import { approvalCardVi, clientsVi, commonVi, mcpVi, modelApiVi, webVi } from './services-copy.vi.ts';

/**
 * MCP 服务、模型接口服务、Web 服务三页的文案（原型 designs/baocut/app/page-services.jsx、page-services-api.jsx、
 * page-services-api-map.jsx、page-services-mcp-tools.jsx 原文，按 Runtime 实际能做的改写；原型里的演示话术不搬）。
 * 服务目录与状态词在 copy.ts（侧栏、总览共用）；这里只放三页自己的话。
 * 英文是键与类型的来源，译文在 `services-copy.<语言>.ts`；每个导出各自一个目录，读属性时取当前语言。
 */

const commonEn = {
  copied: (label: string) => `${label} copied`,
  copyFailed: "Couldn't copy. Select the text and copy it yourself.",
  autostart: 'Start when BaoCut opens',
  stopsWithApp: 'The service stops when you quit BaoCut.',
  portLabel: 'Port',
  portIdle: (port: number) =>
    `Default is ${port}. If it's in use, pick another one: the service shows "Failed to start" and won't switch ports on its own.`,
  portLive: 'Changing the port restarts the service on the new port. Existing connections will drop.',
  portBusy: 'The service is starting or stopping. Try again in a moment.',
  portSaved: (port: number) => `Port changed to ${port}`,
  errorFix: 'Try another port, or quit the app that is using it.',
  resetPort: 'Use default port',
  portReset: (port: number) => `Port reset to the default ${port}`,
  unavailableSub: "This version of BaoCut Runtime doesn't provide this service yet, so it can't be started.",
  started: (name: string) => `${name} started`,
  stopped: (name: string) => `${name} stopped`,
  startFailed: (reason: string) => `Didn't start: ${reason}`,
  restartFailed: (reason: string) => `Saved, but the service couldn't restart with the new settings: ${reason}`,
  section: {
    connect: 'Connect',
    clients: 'Clients and tokens',
    requests: 'Recent requests',
    settings: 'Settings',
  },
  /** 允许的操作：三档的说明随服务不同。 */
  levelLabel: 'Allowed actions',
  levelSaved: (title: string) => `Allowed actions set to "${title}". Takes effect right away.`,
  liveNote: 'Changes take effect right away, no restart needed.',
  noRequests: 'No requests yet',
  requestMeta: (client: string, ago: string, outcome: string) => `${client} · ${ago} · ${outcome}`,
  needToken: 'Require access token',
  needTokenDesc: 'Each app must send its own token (Authorization: Bearer <token>) to connect.',
  needTokenFixed:
    "Tokens are always required in this version and can't be turned off. Each app gets its own token that you can revoke separately, which is safer than no token.",
  cancel: 'Cancel',
  /** 总览标题旁那排灯的读屏文字：每颗灯的说明连成一句。 */
  lightsLabel: (labels: readonly string[]) => labels.join(', '),
};

const clientsEn = {
  lede: "Give each app that connects its own token. A token is shown only once, when it's created, and BaoCut keeps only its fingerprint. Revoke it when you no longer need it, and that app is disconnected right away.",
  empty: 'No clients yet. Create one, then enter its token in the app you want to connect.',
  create: 'Create client',
  createTitle: 'Create client',
  nameLabel: 'App name',
  namePlaceholder: 'For example, Claude Desktop',
  nameDesc: 'Only used to tell callers apart in BaoCut. Request history and approvals show this name.',
  confirmCreate: 'Create',
  cancel: 'Cancel',
  done: 'Done',
  tokenTitle: (name: string) => `Token for "${name}"`,
  tokenOnce:
    "This is the only time you can see this token. Once you close this window it can't be recovered; if you lose it, revoke it and create a new one.",
  tokenLabel: 'Token',
  copyToken: 'Copy token',
  copySnippetWithToken: 'Copy connection info (with token)',
  tokenCopiedLabel: 'Token',
  snippetCopiedLabel: 'Connection info',
  meta: (created: string, used: string | null) => (used ? `Created ${created} · Last used ${used}` : `Created ${created} · Never used`),
  revoke: 'Revoke',
  revokeTitle: (name: string) => `Revoke "${name}"?`,
  revokeBody:
    "Its token stops working right away, and any app using it is disconnected immediately. This can't be undone; to restore access, create a new client and enter the new token.",
  revokeConfirm: 'Revoke',
  revoked: (name: string) => `Revoked "${name}"`,
};

const approvalCardEn = {
  title: (client: string, tool: string) => `${client} wants to call "${tool}"`,
  noVideo: 'Not about a specific video',
  video: (name: string) => `Video "${name}"`,
  left: (s: number) => `${s}s left. Denied if no response.`,
  deny: 'Deny',
  allow: 'Allow',
  allowOnce: 'Allow once',
  allowPersist: 'Allow and remember',
  grantPersistNote:
    '"Allow and remember" also grants a standing permission: it covers this video (or all videos for calls not tied to a video), with no spending or usage limit, and the same outbound call won\'t ask again.',
  allowed: 'Allowed this request',
  denied: 'Denied · The client will get an error',
  already: 'This request has already ended (timed out, handled, or disconnected)',
};

const mcpEn = {
  title: 'MCP service',
  lede: "BaoCut acts as an MCP server and gives other AI apps' agents a set of tools: list and view videos, read transcripts, edit, start transcription and export, and synthesize speech or generate images with the models available on this computer. Off by default. All videos are shared by default, or you can share only some of them.",
  on: 'MCP service running',
  off: 'MCP service not started',
  error: 'MCP service failed to start',
  connectHint:
    'Add the service in any client that supports HTTP MCP: enter the address and send this app\'s token in the request header (create one under "Clients and tokens"). The address stays the same, so you won\'t need to set it up again next time.',
  address: 'MCP address',
  copyAddress: 'Copy MCP address',
  copySnippet: 'Copy connection info',
  snippetLabel: 'Connection info',
  snippetNote: "In the copied config, the token is a placeholder. Replace it with this app's own token.",
  check: 'Check service',
  checkReason: "Runtime doesn't offer a health check to the app yet. The status on the service card is the listening status Runtime reports.",
  accessSection: 'Access',
  scopeTitle: 'Accessible videos',
  scopeDesc:
    "All videos are shared by default (including ones you create later), and the agent uses videos_list to find the one it needs. You can also check only a few; videos outside the selection don't exist for clients. Only videos in registered projects are listed.",
  scopeAll: 'All videos',
  scopeAllSub: (n: number) => `Including future ones · ${n} now`,
  scopePick: 'Only checked videos',
  scopeNone: 'No videos in registered projects yet',
  scopeSaved: 'Access updated. Takes effect right away.',
  levelDesc: "This only applies to external MCP clients. It doesn't affect the built-in agent's access mode.",
  clientsTitle: 'Clients and tokens',
  toolsTitle: 'Tools',
  toolsLede:
    'Once a client connects, these are the tools its agent sees in tools/list (they change with "Allowed actions"). The video parameter comes from videos_list and only accepts videos under "Accessible videos".',
  toolsFixed:
    "This version can't turn tools on or off one by one or show each tool's parameters: tools open together with \"Allowed actions\", and Runtime doesn't give the app the tool list or parameters.",
  toolsHiddenNote: 'Write, task, and generation tools are only offered when "Allowed actions" is set to "Ask before changes" or "Allow without asking".',
  copyTools: 'Copy tools/list',
  toggleTool: (name: string) => `Offer ${name}`,
};

const modelApiEn = {
  title: 'Model API',
  lede: 'Let tools that speak the OpenAI API (SDKs, command-line tools, other apps) use the models BaoCut can use to transcribe, synthesize speech, generate images, and generate text. Listens on this computer only. By default only models on this computer are used; cloud, LAN nodes, and agents each need to be turned on.',
  on: 'Model API running',
  off: 'Model API not started',
  error: 'Model API failed to start',
  offSub: (base: string) => `Once started, serves an OpenAI-compatible API at ${base}`,
  baseUrl: 'Base URL',
  copyBase: 'Copy Base URL',
  baseLede:
    "Paths are the same as OpenAI's; only the host and port change. Set the tool's Base URL to this and use this app's token as the API key. For model, use a name listed by /v1/models (<provider>/<model>, or an alias below).",
  baseOff: 'Reachable once the service starts. You can review settings and docs now.',
  copySnippet: 'Copy environment variables',
  snippetLabel: 'Environment variables',
  needKey: 'Require API key',
  needKeyFixed: "An API key (the client token) is always required in this version and can't be turned off. Each app gets its own, and you can revoke it separately.",
  levels: {
    read: 'Can only list models (GET /v1/models). Generation requests are rejected.',
    ask: 'Confirm each generation request in BaoCut. Denied if no one responds within 50 seconds.',
    auto: "Generation requests run without confirmation. Best when you're the only user.",
  },
  routingTitle: 'Routing',
  routingLede:
    "Models on this computer are always available. Forwarding requests to each of the kinds below must be turned on separately; a kind that's off doesn't appear in /v1/models, and requesting it by name returns 404.",
  routingSaved: 'Routing updated. Takes effect right away.',
  concurrency: 'Concurrent requests per client',
  concurrencyDesc: (max: number) => `Returns 429 when exceeded. 1–${max}.`,
  limits: (upload: string, json: string) => `Uploads (audio to transcribe) up to ${upload}; JSON request bodies up to ${json}.`,
  endpointsTitle: 'Endpoints',
  endpointsLede: 'All paths are under the Base URL.',
  endpointsFixed:
    'This version can\'t turn off endpoints by capability or serve them on a separate port. Endpoint details and "Try it" aren\'t available yet either (the app can\'t see the token in plain text, so it can\'t send requests).',
  modelsGroup: 'Models',
  modelsGroupSub: 'List and look up available models, and get service info',
  capSwitch: (name: string) => `Offer ${name}`,
  ownPort: 'Also serve on a separate port',
  aliasesTitle: 'Aliases',
  aliasesLede:
    'The model in a request is either <provider>/<model> or one of the names below; anything else returns 404. Each name points to one model for one capability. A name that points to "Default model" follows that provider\'s default.',
  aliasesEmpty: 'No aliases yet. Only <provider>/<model> works for now.',
  aliasName: 'Name',
  aliasCapability: 'Capability',
  aliasTarget: 'Points to',
  aliasAdd: 'Add name',
  aliasAdded: (name: string) => `Added "${name}"`,
  aliasRemove: (name: string) => `Delete ${name}`,
  aliasRemoved: (name: string) => `Deleted "${name}"`,
  aliasNoTarget: 'No providers for this capability yet',
  resetAliases: 'Restore defaults',
  resetTitle: 'Restore default aliases?',
  resetBody: 'The table goes back to the preset row (whisper-1 pointing to the default transcription model on this computer). Names you added will be deleted.',
  resetDone: 'Default aliases restored',
  modelsLoading: 'Loading models…',
};

const webEn = {
  title: 'Web service',
  lede: "Open BaoCut Web in a browser on this Mac and edit the same videos. The service listens on this computer only; other devices on your network can't reach it.",
  on: 'Web service running',
  off: 'Web service not started',
  error: 'Web service failed to start',
  offSub: 'Once started, you can open BaoCut Web in a browser.',
  open: 'Open in browser',
  copyLink: 'Copy sign-in link',
  linkLabel: 'Sign-in link',
  copyAddress: 'Copy address',
  addressLabel: 'Address',
  linkNote: 'A browser first signs in with a one-time link (valid for 2 minutes, single use). After that, just open the address for the next 12 hours.',
  openFallback: "Can't open an external browser from here. The sign-in link is copied; paste it into your browser's address bar.",
  sessionsTitle: 'Open browser sessions',
  sessionsEmpty: 'No browser has signed in yet. Click "Open in browser".',
  revoke: 'Sign out',
  revokeTitle: 'Sign out this browser?',
  revokeBody: "Its connection drops right away. To use it again, you'll need to open a new sign-in link.",
  revokeConfirm: 'Sign out',
  revoked: 'Signed out this browser',
  readOnly: 'Read only',
  readOnlyDesc: "When on, browsers can only view videos, transcripts, and tasks. They can't make changes or submit tasks.",
  readOnlySaved: (on: boolean): string => (on ? 'Set to read only. Takes effect right away.' : 'Browsers can now make changes. Takes effect right away.'),
  apiMoved: 'The OpenAI-compatible API is now a separate service:',
  apiMovedLink: 'Model API',
};

export type CommonMessages = typeof commonEn;
export type ClientsMessages = typeof clientsEn;
export type ApprovalCardMessages = typeof approvalCardEn;
export type McpMessages = typeof mcpEn;
export type ModelApiMessages = typeof modelApiEn;
export type WebMessages = typeof webEn;

export const COMMON_COPY = defineMessages(commonEn, { 'zh-Hans': commonZh, 'zh-Hant': commonZhHant, ja: commonJa, ko: commonKo, es: commonEs, fr: commonFr, de: commonDe, nl: commonNl, 'pt-BR': commonPtBR, it: commonIt, ru: commonRu, pl: commonPl, tr: commonTr, vi: commonVi });
export const CLIENTS_COPY = defineMessages(clientsEn, { 'zh-Hans': clientsZh, 'zh-Hant': clientsZhHant, ja: clientsJa, ko: clientsKo, es: clientsEs, fr: clientsFr, de: clientsDe, nl: clientsNl, 'pt-BR': clientsPtBR, it: clientsIt, ru: clientsRu, pl: clientsPl, tr: clientsTr, vi: clientsVi });
export const APPROVAL_CARD_COPY = defineMessages(approvalCardEn, { 'zh-Hans': approvalCardZh, 'zh-Hant': approvalCardZhHant, ja: approvalCardJa, ko: approvalCardKo, es: approvalCardEs, fr: approvalCardFr, de: approvalCardDe, nl: approvalCardNl, 'pt-BR': approvalCardPtBR, it: approvalCardIt, ru: approvalCardRu, pl: approvalCardPl, tr: approvalCardTr, vi: approvalCardVi });
export const MCP_COPY = defineMessages(mcpEn, { 'zh-Hans': mcpZh, 'zh-Hant': mcpZhHant, ja: mcpJa, ko: mcpKo, es: mcpEs, fr: mcpFr, de: mcpDe, nl: mcpNl, 'pt-BR': mcpPtBR, it: mcpIt, ru: mcpRu, pl: mcpPl, tr: mcpTr, vi: mcpVi });
export const MODEL_API_COPY = defineMessages(modelApiEn, { 'zh-Hans': modelApiZh, 'zh-Hant': modelApiZhHant, ja: modelApiJa, ko: modelApiKo, es: modelApiEs, fr: modelApiFr, de: modelApiDe, nl: modelApiNl, 'pt-BR': modelApiPtBR, it: modelApiIt, ru: modelApiRu, pl: modelApiPl, tr: modelApiTr, vi: modelApiVi });
export const WEB_COPY = defineMessages(webEn, { 'zh-Hans': webZh, 'zh-Hant': webZhHant, ja: webJa, ko: webKo, es: webEs, fr: webFr, de: webDe, nl: webNl, 'pt-BR': webPtBR, it: webIt, ru: webRu, pl: webPl, tr: webTr, vi: webVi });
