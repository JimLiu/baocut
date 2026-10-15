import {
  ONLINE_CAPABILITIES,
  type ModelCapabilitiesView,
  type ModelInfoBase,
  type OnlineCapability,
  type ProviderAccountView,
  type ProviderCapabilityView,
  type ProviderConfigView,
  type ProviderVendorInfo,
} from '@baocut/protocol';
import type { AgentIconSpec } from './agent-choice.ts';
import { isCustomProvider, normalizeEndpoint } from './models-cloud.ts';

/**
 * 设置 › 模型 › API 提供方（产品设计 §7.6；设计稿 model-vendors.js）：把 `models` 主题的能力视图折成「一家一行」。
 * 一家 API 提供方 = 厂商或中转平台的一个接入（内置的按服务商目录，自建的是 `custom:<slug>`）；一个账号 = 一把密钥；
 * 一把密钥对这家的全部能力生效。没有单独的 Provider 列表接口：各能力视图里 `kind: 'online'` 的合起来就是全部。
 * 账号有序，一次调用用第一个启用且有密钥的账号，出错时不换号（架构设计 §6.2）。只算，不画；文案在 providers-copy.ts。
 */

/** 目录顺序（设计稿 model-vendors.js 的 `VENDORS`）：列表、添加 sheet 与能力页同档内按它排；没写的内置跟在后面，自建最后。 */
const CATALOG_ORDER = [
  'openai',
  'anthropic',
  'google',
  'elevenlabs',
  'deepseek',
  'moonshot',
  'qwen',
  'zhipu',
  'minimax',
  'volcengine',
  'volcengine-speech',
  'xai',
  'mistral',
  'groq',
  'openrouter',
  'siliconflow',
];

/** 能力的显示顺序（设计稿 `CAPS`：文本、识别、合成、生图）。 */
export const PROVIDER_CAPABILITIES: readonly OnlineCapability[] = ['generateText', 'transcribe', 'synthesizeSpeech', 'generateImage'];

export type ApiProviderKind = 'vendor' | 'relay' | 'custom';

export interface ApiProvider {
  providerId: string;
  label: string;
  kind: ApiProviderKind;
  vendor: ProviderVendorInfo;
  config: ProviderConfigView | null;
  accounts: ProviderAccountView[];
  /** 已实现的能力（自建的只算声明了模型的），按 `PROVIDER_CAPABILITIES` 排。 */
  capabilities: OnlineCapability[];
  /** 目录里有、还没接入的能力（详情里标「尚未接入」）。 */
  planned: OnlineCapability[];
  /** 列在 API 提供方页：自建的，或启用过、有账号的内置。 */
  added: boolean;
  /** 排序用：目录里的位置。 */
  order: number;
}

const isOnline = (c: string): c is OnlineCapability => (ONLINE_CAPABILITIES as readonly string[]).includes(c);

function orderOf(providerId: string, seen: number): number {
  const at = CATALOG_ORDER.indexOf(providerId);
  if (at >= 0) return at;
  return isCustomProvider(providerId) ? 10_000 + seen : 1_000 + seen;
}

/** 视图里全部的在线 Provider（智能体与本机不算），每家一项。 */
export function apiProviders(view: ModelCapabilitiesView): ApiProvider[] {
  const entries = new Map<string, ProviderCapabilityView>();
  const caps = new Map<string, Set<OnlineCapability>>();
  for (const capability of ONLINE_CAPABILITIES) {
    for (const p of view[capability].providers) {
      if (p.kind !== 'online') continue;
      if (!entries.has(p.providerId)) entries.set(p.providerId, p);
      const custom = isCustomProvider(p.providerId);
      if (!custom || p.models.length > 0) {
        const set = caps.get(p.providerId) ?? new Set<OnlineCapability>();
        set.add(capability);
        caps.set(p.providerId, set);
      }
    }
  }
  let seen = 0;
  return [...entries.values()].map((p) => {
    const custom = isCustomProvider(p.providerId);
    const vendor: ProviderVendorInfo = p.vendor ?? { kind: custom ? 'custom' : 'vendor' };
    const kind: ApiProviderKind = custom ? 'custom' : vendor.kind === 'relay' ? 'relay' : 'vendor';
    const have = caps.get(p.providerId) ?? new Set<OnlineCapability>();
    const capabilities = PROVIDER_CAPABILITIES.filter((c) => have.has(c));
    const planned = PROVIDER_CAPABILITIES.filter((c) => !have.has(c) && (vendor.planned ?? []).filter(isOnline).includes(c));
    const accounts = p.config?.accounts ?? [];
    return {
      providerId: p.providerId,
      label: p.label,
      kind,
      vendor,
      config: p.config,
      accounts,
      capabilities,
      planned,
      added: custom || !!p.config?.enabled || accounts.length > 0,
      order: orderOf(p.providerId, seen++),
    };
  });
}

export function findApiProvider(view: ModelCapabilitiesView, providerId: string): ApiProvider | null {
  return apiProviders(view).find((p) => p.providerId === providerId) ?? null;
}

/** 这家的模型数：各能力下的模型 ID 去重（同一个模型可能在几种能力下都列着）。 */
export function providerModelCount(view: ModelCapabilitiesView, providerId: string): number {
  const ids = new Set<string>();
  for (const capability of ONLINE_CAPABILITIES) {
    for (const model of view[capability].providers.find((p) => p.providerId === providerId)?.models ?? []) ids.add(model.modelId);
  }
  return ids.size;
}

/** 单色的厂商图标（跟文字颜色）；其余彩色原样画（设计稿 model-vendors.js 的 `icon.mono`）。 */
const MONO_ICONS = new Set(['openai', 'anthropic', 'elevenlabs', 'moonshot', 'xai', 'groq', 'openrouter']);

/** 一家的图标：目录给了图标 ID 的用 `vendor-icons/<id>.svg`，自建的与没有图标的用名字首字母。 */
export function providerIcon(provider: Pick<ApiProvider, 'providerId' | 'label' | 'vendor'>): AgentIconSpec {
  const file = provider.vendor.icon;
  if (file) return { kind: 'vendor', file, mono: MONO_ICONS.has(file) };
  const letter = [...(provider.label.trim() || provider.providerId.replace(/^custom:/, ''))][0] ?? '?';
  return { kind: 'letter', letter: letter.toLocaleUpperCase() };
}

/** 目录声明的全部能力（已实现 + 尚未接入），按显示顺序。 */
export function catalogCapabilities(provider: Pick<ApiProvider, 'capabilities' | 'planned'>): OnlineCapability[] {
  return PROVIDER_CAPABILITIES.filter((c) => provider.capabilities.includes(c) || provider.planned.includes(c));
}

// ---- 账号 ----

export type AccountTone = 'neutral' | 'positive' | 'negative' | 'notice';

/** 账号徽标（设计稿 `statusOf`）：停用、密钥无效、额度用尽、限速（到恢复时间就当正常）、正常、未验证。 */
export type AccountStatus =
  | { kind: 'disabled'; tone: 'neutral' }
  | { kind: 'invalid-key'; tone: 'negative' }
  | { kind: 'quota'; tone: 'negative' }
  | { kind: 'rate-limited'; tone: 'notice'; until: string | null }
  | { kind: 'ok'; tone: 'positive' }
  | { kind: 'unverified'; tone: 'neutral' };

export function accountStatus(account: ProviderAccountView, now: number): AccountStatus {
  if (!account.enabled) return { kind: 'disabled', tone: 'neutral' };
  const s = account.status;
  if (s.state === 'invalid-key') return { kind: 'invalid-key', tone: 'negative' };
  if (s.state === 'quota-exhausted') return { kind: 'quota', tone: 'negative' };
  if (s.state === 'rate-limited') {
    if (s.until && Date.parse(s.until) <= now) return { kind: 'ok', tone: 'positive' };
    return { kind: 'rate-limited', tone: 'notice', until: s.until ?? null };
  }
  if (s.state === 'ok') return { kind: 'ok', tone: 'positive' };
  return { kind: 'unverified', tone: 'neutral' };
}

const usable = (a: ProviderAccountView) => a.enabled && a.credential === 'set';

/** 生效的账号：第一个启用且有密钥的（不跳过限速、失效的：不自动换号）。 */
export function primaryAccount(accounts: readonly ProviderAccountView[]): ProviderAccountView | null {
  return accounts.find(usable) ?? null;
}

/** 「设为首选」= 挪到最前，其余保持原来的先后（`models.arrangeAccounts` 的 `order`）。 */
export function primaryOrder(accounts: readonly ProviderAccountView[], accountId: string): string[] {
  return [accountId, ...accounts.map((a) => a.accountId).filter((id) => id !== accountId)];
}

// ---- 一家此刻的状态 ----

/**
 * 设计稿 `stateOf`：停用；没有能用的账号（一个没有 / 都停用了）；首选账号上次出错（密钥无效、额度、限速）；已连接；
 * 还没添加（只在能力页出现）。自建的有地址就算连上（本机、内网的服务常常不要密钥），与 `providerConnected` 一致。
 */
export type ProviderState =
  | { kind: 'off' }
  | { kind: 'none' }
  | { kind: 'no-account' }
  | { kind: 'accounts-off' }
  | { kind: 'warn'; status: AccountStatus }
  | { kind: 'ok' };

export function providerState(provider: Pick<ApiProvider, 'providerId' | 'config' | 'accounts' | 'added' | 'kind'>, now: number): ProviderState {
  if (!provider.added) return { kind: 'none' };
  if (!provider.config?.enabled) return { kind: 'off' };
  const primary = primaryAccount(provider.accounts);
  if (!primary) {
    // 自建的有地址就算连上；视图没带账号（旧 Runtime）时按 `credential` 算。
    if ((provider.kind === 'custom' && provider.config.endpoint) || (!provider.accounts.length && provider.config.credential === 'set')) return { kind: 'ok' };
    return { kind: provider.accounts.length ? 'accounts-off' : 'no-account' };
  }
  const status = accountStatus(primary, now);
  if (status.tone === 'negative' || status.tone === 'notice') return { kind: 'warn', status };
  return { kind: 'ok' };
}

/** 能用：已连接，或首选账号上次出过错（照样会用它调）。 */
export const stateReady = (state: ProviderState) => state.kind === 'ok' || state.kind === 'warn';

// ---- API 提供方页 ----

export interface ProviderRow {
  provider: ApiProvider;
  state: ProviderState;
}

/** 列表：已添加的那些，能用的排前，其次按目录顺序（自建最后）。 */
export function providerRows(view: ModelCapabilitiesView, now: number): ProviderRow[] {
  return apiProviders(view)
    .filter((p) => p.added)
    .map((provider) => ({ provider, state: providerState(provider, now) }))
    .sort((a, b) => Number(stateReady(b.state)) - Number(stateReady(a.state)) || a.provider.order - b.provider.order);
}

/** 「自建端点 · OpenAI 兼容」那张卡命中的词（设计稿 `CUSTOM_TERMS`；任一方向包含）。 */
// i18n-ignore-start: 搜索同义词，中英文写法都要能命中，不随界面语言变
const CUSTOM_TERMS = ['自建端点', 'openai 兼容', 'openai', '兼容', '自建', 'custom', 'compatible', '端点', 'endpoint'];
// i18n-ignore-end

export function customCardHit(query: string, extraTerms: readonly string[] = []): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [...CUSTOM_TERMS, ...extraTerms.map((t) => t.toLowerCase())].some((t) => t.includes(q) || q.includes(t));
}

export interface CatalogCard {
  provider: ApiProvider;
  /** 目录声明的能力（含尚未接入的）。 */
  capabilities: OnlineCapability[];
}

export interface ProviderCatalog {
  vendors: CatalogCard[];
  relays: CatalogCard[];
  /** 自建端点卡在不在。 */
  custom: boolean;
}

/**
 * 添加 API 提供方（设计稿 `catalog`）：内置的按名字、ID 与能力名搜，分模型厂商与中转平台；已添加的照样列（卡上标出来）。
 * `capabilityLabel` 给能力的显示名（按界面语言），`customTerms` 是自建端点卡的显示名，一起参与匹配。
 */
export function providerCatalog(
  view: ModelCapabilitiesView,
  query: string,
  capabilityLabel: (c: OnlineCapability) => string,
  customTerms: readonly string[] = [],
): ProviderCatalog {
  const q = query.trim().toLowerCase();
  const cards = apiProviders(view)
    .filter((p) => p.kind !== 'custom')
    .sort((a, b) => a.order - b.order)
    .map((provider) => ({ provider, capabilities: catalogCapabilities(provider) }))
    .filter(({ provider, capabilities }) => !q || [provider.providerId, provider.label, ...capabilities.map(capabilityLabel)].join(' ').toLowerCase().includes(q));
  return {
    vendors: cards.filter((c) => c.provider.kind === 'vendor'),
    relays: cards.filter((c) => c.provider.kind === 'relay'),
    custom: customCardHit(q, customTerms),
  };
}

// ---- 地址 ----

/** 「https://api.openai.com/v1」→「api.openai.com」。 */
export function hostOf(url: string | null | undefined): string {
  return String(url ?? '').replace(/^[a-z]+:\/\//i, '').split('/')[0] ?? '';
}

/**
 * 一个账号实际用的基址（架构设计 §6.4、§6.8）：账号的 `endpoint` → 这家的 `endpoint`（自建端点的地址、或改写过的基址）→
 * 账号所选地区的预设 → 目录预设。`region` 给了时按它算（添加账号时还没有账号）。
 */
export function accountBase(provider: Pick<ApiProvider, 'vendor' | 'config'>, account: { endpoint?: string | null; region?: string | null }): string {
  const own = account.endpoint?.trim();
  if (own) return own;
  if (provider.config?.endpoint) return provider.config.endpoint;
  const regional = account.region ? provider.vendor.regionBaseUrls?.[account.region] : undefined;
  return regional ?? provider.vendor.baseUrl ?? '';
}

/** 这家眼下的基址（页头与查重用）：自建的是填的地址；内置的是改写过的基址，或第一个账号所在地区 / 目录预设的。 */
export function providerBase(provider: Pick<ApiProvider, 'vendor' | 'config' | 'accounts'>): string {
  return accountBase(provider, { region: provider.accounts[0]?.region ?? null });
}

/** 填的地址已经是哪一家的（自建的按填的地址；内置的按改写过的基址与目录里每个地区的预设）。 */
export function endpointOwner(view: ModelCapabilitiesView, url: string): ApiProvider | null {
  const key = normalizeEndpoint(url);
  if (!key) return null;
  return (
    apiProviders(view).find((p) => {
      const bases = [p.config?.endpoint, p.vendor.baseUrl, ...Object.values(p.vendor.regionBaseUrls ?? {})];
      return bases.some((b) => !!b && normalizeEndpoint(b) === key);
    }) ?? null
  );
}

/** 像 http(s) 地址（设计稿 `validBase`）；空着由调用方当「用默认」。 */
export function looksLikeEndpoint(url: string): boolean {
  return /^https?:\/\/[^\s/]+/i.test(url.trim());
}

// ---- 能力页的 API 提供方一节 ----

export interface CapabilityGroup {
  provider: ApiProvider;
  state: ProviderState;
  ready: boolean;
  models: ModelInfoBase[];
}

/**
 * 能力页第 ④ 节（设计稿 `capCatalog`）：有这种能力的全部 API 提供方（没添加的也列，从这里去配置）。尚未接入的能力不算。
 * 排序：能用的 › 已添加但没有能用的账号（含停用）› 没添加；同档按目录顺序，自建最后。查询词按名字、ID 与模型 ID 匹配，命中的整组返回。
 */
export function capabilityGroups(view: ModelCapabilitiesView, capability: OnlineCapability, now: number, query = ''): CapabilityGroup[] {
  const q = query.trim().toLowerCase();
  const tier = (g: CapabilityGroup) => (g.ready ? 0 : g.provider.added ? 1 : 2);
  return apiProviders(view)
    .filter((p) => p.capabilities.includes(capability))
    .map((provider) => {
      const state = providerState(provider, now);
      const entry = view[capability].providers.find((p) => p.providerId === provider.providerId);
      return { provider, state, ready: stateReady(state), models: (entry?.models ?? []) as ModelInfoBase[] };
    })
    .filter((g) => !q || [g.provider.providerId, g.provider.label, ...g.models.map((m) => m.modelId)].join(' ').toLowerCase().includes(q))
    .sort((a, b) => tier(a) - tier(b) || a.provider.order - b.provider.order);
}

/** 这家在这种能力下的那一项（能不能用、模型）。 */
export function capabilityEntry(view: ModelCapabilitiesView, capability: OnlineCapability, providerId: string): ProviderCapabilityView | null {
  return (view[capability].providers.find((p) => p.providerId === providerId) as ProviderCapabilityView | undefined) ?? null;
}

/** 默认模型菜单只列已添加的 API 提供方（设计稿 settings-capability.jsx ①）。 */
export function addedProviderIds(view: ModelCapabilitiesView): Set<string> {
  return new Set(apiProviders(view).filter((p) => p.added).map((p) => p.providerId));
}
