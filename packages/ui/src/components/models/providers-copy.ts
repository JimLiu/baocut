import { defineMessages, live, type OnlineCapability, type UsagePeriod } from '@baocut/protocol';
import { zhHans } from './providers-copy.zh-Hans.ts';
import { zhHant } from './providers-copy.zh-Hant.ts';
import { ja } from './providers-copy.ja.ts';
import { ko } from './providers-copy.ko.ts';
import { es } from './providers-copy.es.ts';
import { fr } from './providers-copy.fr.ts';
import { de } from './providers-copy.de.ts';
import { nl } from './providers-copy.nl.ts';
import { ptBR } from './providers-copy.pt-BR.ts';
import { it } from './providers-copy.it.ts';
import { ru } from './providers-copy.ru.ts';
import { pl } from './providers-copy.pl.ts';
import { tr } from './providers-copy.tr.ts';
import { vi } from './providers-copy.vi.ts';

/**
 * 设置 › 模型 › API 提供方、用量与能力页「API 提供方」一节的文案（产品设计 §7.6；设计稿 settings-providers.jsx、
 * settings-provider-detail.jsx、settings-usage.jsx、settings-capability.jsx）。设计稿里演示用的说法（原型验证结果、
 * 演示数据、查余额）不搬过来。英文是键与类型的来源，译文在 `providers-copy.<语言>.ts`。
 */

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const en = {
  /** 能力的短名（列表的副行、添加卡片、详情页头）。全名用 models-cloud.ts 的 `CAPABILITY_SHORT`。 */
  capShort: {
    generateText: 'Text',
    transcribe: 'ASR',
    synthesizeSpeech: 'TTS',
    generateImage: 'Image',
  } satisfies Record<OnlineCapability, string>,
  /** 地区（目录的 `regions`）；没写的地区直接显示它的 ID。 */
  region: { global: 'International', cn: 'China' } as Record<string, string>,
  tag: { relay: 'Relay', custom: 'Custom' },
  /** 一家此刻的状态（`ProviderState`）。 */
  state: {
    off: 'Disabled',
    none: 'Not added',
    noAccount: 'No account',
    accountsOff: 'All accounts disabled',
    ok: 'Connected',
  },
  /** 账号徽标（`AccountStatus`）。`until` 是已经按界面语言写好的时刻。 */
  account: {
    disabled: 'Disabled',
    invalidKey: 'Invalid key',
    quota: 'Quota used up',
    rateLimited: 'Rate limited',
    rateLimitedUntil: (until: string) => `Rate limited · back at ${until}`,
    ok: 'OK',
    unverified: 'Not verified',
  },
  list: {
    title: 'API providers',
    intro:
      'One key works for all of a provider’s capabilities: add it to OpenAI once and text generation, speech recognition, speech synthesis and image generation can all use it. Coding Agent sign-ins (Codex, Claude) are under “Agent”.',
    label: 'Added API providers',
    empty: 'No API providers yet. Add one and enter a key, and each capability page can pick its models.',
    add: 'Add API provider',
    accounts: (n: number) => count(n, 'account', 'accounts'),
    /** 自建端点没有账号（不用密钥的服务）。 */
    noKey: 'No key',
    models: (n: number) => count(n, 'model', 'models'),
    open: (name: string, state: string) => `${name} · ${state}`,
    missing: 'This API provider was removed, or hasn’t been added yet.',
    back: 'Back to API providers',
    webNote:
      'A browser can’t add or remove API providers, change accounts and keys, refresh model lists or change defaults. You can still view them, test models and see usage. Do the rest in the BaoCut desktop app.',
  },
  sheet: {
    title: 'Add API provider',
    search: 'Search API providers',
    searchPlaceholder: 'Search providers or capabilities',
    vendors: 'Model vendors',
    relays: 'Relay platforms',
    relaysNote: 'One key calls models from many vendors, billed at the relay platform’s prices.',
    added: 'Added',
    customCard: 'Custom endpoint',
    customCardDesc: 'OpenAI-compatible · a local service, a gateway, or a provider that isn’t listed',
    customCardLabel: 'Custom endpoint · OpenAI-compatible: enter a name and URL',
    noMatch: (query: string) => `Nothing matches “${query}”. You can add it below as a custom endpoint.`,
    custom: 'Custom endpoint (OpenAI-compatible)',
    customNote: 'A service on this computer or your network, a company gateway and so on. It must support the OpenAI-compatible API.',
    name: 'Name',
    namePlaceholder: 'Name, e.g. Local vLLM',
    url: 'URL',
    protocol: 'Protocol',
    protocolValue: 'OpenAI-compatible',
    model: 'First model ID',
    capability: 'What this model does',
    /** 地址是一家内置提供方的预设基址。 */
    builtin: (name: string) => `This is ${name}’s address. Add ${name} instead: its models are already built in.`,
    builtinAction: (name: string) => `Add ${name}`,
    builtinOpen: (name: string) => `Open ${name}`,
    badUrl: 'The URL must start with http:// or https://.',
    addCustom: 'Add custom endpoint',
    close: 'Close',
    failed: (message: string) => `Couldn't add: ${message}`,
  },
  detail: {
    back: 'API providers',
    relay: 'Relay platform',
    custom: 'Custom endpoint · OpenAI-compatible',
    enable: (name: string) => `Enable ${name}`,
    off: 'Disabled: its models can’t be picked on the capability pages. Accounts and settings are kept.',
    toggleFailed: (message: string) => `Couldn't change it: ${message}`,
    accounts: 'Accounts',
    accountsOf: (name: string) => `${name} accounts`,
    noAccounts: 'No accounts yet. Add a key and all of this provider’s capabilities can use it.',
    noAccountsCustom: 'No accounts. A service that doesn’t need a key works without one; add an account if yours does.',
    order:
      'Calls always use the first enabled account; if it fails, the next one isn’t tried automatically. Use “Make primary” to change the order.',
    addAccount: 'Add account',
    primary: 'Primary',
    makePrimary: 'Make primary',
    removeAccount: 'Remove account',
    enableAccount: (name: string) => `Enable account ${name}`,
    editAccount: (name: string) => `Edit ${name}`,
    editGroup: (name: string) => `Edit account ${name}`,
    unnamed: 'Unnamed account',
    lastUsed: (ago: string) => `Last used ${ago}`,
    neverUsed: 'Not used yet',
    keyMissing: 'Key missing',
    label: 'Account name',
    labelPlaceholder: (masked: string) => `Name (optional); shows ${masked} if empty`,
    labelPlaceholderNew: 'Name (optional), e.g. Team',
    key: 'Key',
    keyPlaceholder: 'Paste key',
    region: 'Region',
    regionDesc: 'International and China sites are separate services, and their keys don’t work on each other.',
    endpointTitle: 'Endpoint (advanced)',
    endpoint: 'Endpoint URL',
    endpointHint: 'Leave empty to use the default address. If you point it at your proxy or gateway, this key is sent there. Applies only to this account.',
    endpointEditHint: 'Leave the endpoint empty to use the default address. If you point it at your proxy or gateway, this key is sent there.',
    keyNote: 'Before saving, the key is verified with this provider; if that fails it isn’t saved. It’s stored only on this computer and only its masked form is shown afterwards.',
    verify: 'Verify and save',
    save: 'Save',
    cancel: 'Cancel',
    saved: (label: string) => (label ? `Verified and saved account “${label}”` : 'Verified and saved the account'),
    updated: 'Account saved',
    failed: (message: string) => `Couldn't save: ${message}`,
    removeTitle: (name: string) => `Remove account “${name}”?`,
    removeBodyLast: (provider: string) =>
      `This key is deleted from this computer. It’s ${provider}’s only account: the provider stays, but without a usable key its models won’t be available.`,
    removeBody: 'This key is deleted from this computer. Calls switch to the first enabled account among the rest.',
    removed: (name: string) => `Removed account “${name}”`,
    caps: 'Capabilities and models',
    planned: 'Not supported yet',
    plannedNote: 'BaoCut doesn’t support this capability for this provider yet: it’s listed, but can’t be tested or set as the default.',
    noModels: 'No models yet. Add a model ID.',
    addModel: 'Add model',
    addModelTo: (capability: string) => `Add a ${capability} model`,
    probe: 'Test…',
    needsAccount: 'Add an account to test these models.',
    usage: 'Usage',
    last30: 'Last 30 days',
    today: 'Today',
    viewUsage: 'View usage',
    removeProvider: 'Remove API provider',
    removeProviderTitle: (name: string) => `Remove API provider “${name}”?`,
    removeProviderBody: (accounts: number) =>
      `Its ${count(accounts, 'account', 'accounts')} (keys) are deleted from this computer. Default models that point to it are kept but become unavailable until you pick another. Usage records are kept.`,
    removeProviderBodyCustom: (accounts: number) =>
      `Its models and ${count(accounts, 'account', 'accounts')} (keys) are deleted from this computer. Default models that point to it are kept but become unavailable until you pick another. Usage records are kept.`,
    removeProviderBodyEmpty: 'Default models that point to it are kept but become unavailable until you pick another. Usage records are kept.',
    removeProviderBodyCustomEmpty: 'Its models are deleted from this computer. Default models that point to it are kept but become unavailable until you pick another. Usage records are kept.',
    providerRemoved: (name: string) => `Removed “${name}”`,
    removeFailed: (message: string) => `Couldn't remove: ${message}`,
  },
  usage: {
    title: 'Usage',
    intro: 'Calls, usage and spending for API providers and Agents. Local models aren’t billed and aren’t counted here.',
    period: 'Period',
    periods: { today: 'Today', '7d': '7 days', '30d': '30 days', all: 'All' } satisfies Record<UsagePeriod, string>,
    only: (name: string) => `Only ${name}`,
    showAll: 'Show all providers',
    estimated: (money: string) => `≈ ${money} · estimated from list prices`,
    estimatedUnknown: (n: number) => ` · ${n} unknown`,
    estimatedTip: (unknown: number) =>
      `Estimated from each provider’s list prices, which may be out of date.${unknown ? ` Another ${count(unknown, 'call has', 'calls have')} unknown cost (Agent calls, or models without a list price).` : ''}`,
    reported: (money: string) => `${money} · reported by providers`,
    emptyTitle: 'No calls yet',
    emptyAll: 'No API provider or Agent was called in this period. Once you use their models, calls and spending show up here.',
    emptyOne: (name: string) => `${name} wasn’t called in this period.`,
    tile: { calls: 'Calls', tokens: 'Text tokens', audio: 'Audio', chars: 'Characters', images: 'Images' },
    calls: (n: number) => count(n, 'call', 'calls'),
    failed: (n: number) => `${n} failed`,
    noFailures: 'No failures',
    tokens: (input: string, output: string) => `${input} in · ${output} out`,
    chars: (n: string) => `${n} chars`,
    images: (n: number) => count(n, 'image', 'images'),
    byDay: 'By day',
    chart: (calls: number) => `Calls per day, ${count(calls, 'call', 'calls')} in total`,
    dayTip: (day: string, calls: number) => `${day} · ${count(calls, 'call', 'calls')}`,
    split: 'Breakdown',
    splits: { byProvider: 'By provider', byCapability: 'By capability', byModel: 'By model', byAccount: 'By account' },
    columns: { name: 'Name', calls: 'Calls', share: 'Share', units: 'Usage', cost: 'Cost' },
    rowCalls: (calls: number, failed: number) => (failed ? `${calls} · ${failed} failed` : String(calls)),
    cost: {
      unknown: 'Unknown cost',
      subscription: 'Included in subscription',
      estimated: (money: string) => `≈ ${money}`,
      reported: (money: string) => `${money} reported`,
      mixed: (money: string) => `≈ ${money} (incl. reported)`,
    },
    note: '≈ is estimated from each provider’s list prices, which may be out of date; “reported” is the amount the provider returned. Different currencies are listed separately, not converted.',
    /** 详情的用量卡。 */
    cardEstimated: (money: string) => `≈ ${money} · estimated`,
    cardReported: (money: string) => `${money} reported`,
    cardUnknown: (n: number) => `${n} with unknown cost`,
    cardNone: 'No spending',
    loading: 'Loading usage…',
    loadFailed: (message: string) => `Couldn't load usage: ${message}`,
  },
  /** 能力页的「API 提供方」一节与「本机模型」一节的标题。 */
  capability: {
    local: 'Local models',
    title: 'API providers',
    desc: 'Providers that offer this capability. Once you add a key, their models can be picked.',
    manage: 'Manage API providers',
    search: 'Search providers or models',
    configure: 'Set up',
    configureLabel: (name: string) => `Set up ${name}`,
    primaryWarn: (status: string) => `Primary account ${status}`,
    noModels: 'No models yet. Add a model ID in its details.',
    customLead: 'Don’t see your provider?',
    customAction: 'Add an OpenAI-compatible endpoint',
    noMatch: (query: string) => `Nothing matches “${query}”. You can add it as a custom endpoint on the API providers page.`,
    expand: (name: string) => `Show ${name} models`,
    collapse: (name: string) => `Hide ${name} models`,
  },
};

export type ProvidersMessages = typeof en;

const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

export const CAP_SHORT: Record<OnlineCapability, string> = live(() => M.capShort);
export const PROVIDER_STATE_COPY = live(() => M.state);
export const ACCOUNT_STATUS_COPY = live(() => M.account);
export const PROVIDERS_COPY = live(() => M.list);
export const ADD_PROVIDER_COPY = live(() => M.sheet);
export const PROVIDER_DETAIL_COPY = live(() => M.detail);
export const USAGE_COPY = live(() => M.usage);
export const CAP_PROVIDERS_COPY = live(() => M.capability);

/** 地区的名字；目录里有、这里没写的地区直接显示 ID。 */
export const regionLabel = (region: string) => M.region[region] ?? region;
export const providerTag = (kind: 'vendor' | 'relay' | 'custom') => (kind === 'vendor' ? null : M.tag[kind]);
