import {
  formatRef,
  live,
  LOCALES,
  type ModelApiAlias,
  type ModelApiRouting,
  type ModelCapabilitiesView,
  type OnlineCapability,
  type ProviderCapabilityView,
  type ProviderKind,
} from '@baocut/protocol';
import { M, type ServicesApiMessages } from './services-api-copy.ts';

/**
 * 模型接口服务页的纯模型（原型 designs/baocut/app/page-services-api.jsx、page-services-api-map.jsx；架构设计 §4.8）：
 * 端点目录、路由开关、每种能力此刻能路由到的模型、别名表的说明与校验、添加别名时的目标选项。
 * 路由规则照 Runtime 的 model-api-routing.ts：本机（`local`）总在；在线、节点、智能体 Provider 要分别打开路由开关；只算可用的。
 */

export const CAPABILITY_LABEL: Readonly<Record<OnlineCapability, string>> = live(() => M.capabilities);

export const API_CAPABILITIES: readonly OnlineCapability[] = ['transcribe', 'synthesizeSpeech', 'generateImage', 'generateText'];

export interface ApiEndpoint {
  method: 'GET' | 'POST';
  path: string;
  title: string;
  /** 这个端点用哪种能力；查询类为 null。 */
  capability: OnlineCapability | null;
}

/** 端点（Runtime model-api-service.ts 的路由表）：路径与 OpenAI 相同，外加 BaoCut 自己的信息端点。 */
const ENDPOINT_ROWS: readonly (readonly [ApiEndpoint['method'], string, keyof ServicesApiMessages['endpoints'], OnlineCapability | null])[] = [
  ['GET', '/models', 'models', null],
  ['GET', '/models/{model}', 'model', null],
  ['GET', '/baocut/info', 'info', null],
  ['POST', '/audio/transcriptions', 'transcriptions', 'transcribe'],
  ['POST', '/audio/speech', 'speech', 'synthesizeSpeech'],
  ['POST', '/images/generations', 'images', 'generateImage'],
  ['POST', '/chat/completions', 'chat', 'generateText'],
];

export const API_ENDPOINTS: readonly ApiEndpoint[] = ENDPOINT_ROWS.map(([method, path, title, capability]) => ({
  method,
  path,
  get title() {
    return M.endpoints[title];
  },
  capability,
}));

export const ROUTING_ROWS: readonly { key: keyof ModelApiRouting; label: string; desc: string }[] = (['online', 'nodes', 'agent'] as const).map((key) => ({
  key,
  get label() {
    return M.routing[key].label;
  },
  get desc() {
    return M.routing[key].desc;
  },
}));

export function routable(kind: ProviderKind, routing: ModelApiRouting): boolean {
  if (kind === 'local') return true;
  if (kind === 'online') return routing.online;
  if (kind === 'node') return routing.nodes;
  return routing.agent;
}

function providers(view: ModelCapabilitiesView, capability: OnlineCapability): ProviderCapabilityView[] {
  return view[capability].providers as ProviderCapabilityView[];
}

/** 这种能力此刻能路由到的模型数（`/v1/models` 里会列出的 `<providerId>/<modelId>`）。 */
export function routableModelCount(view: ModelCapabilitiesView, capability: OnlineCapability, routing: ModelApiRouting): number {
  let n = 0;
  for (const p of providers(view, capability)) {
    if (!p.available || !routable(p.kind, routing)) continue;
    n += p.models.filter((m) => m.available !== false).length;
  }
  return n;
}

/** 一种能力的一句：「3 个模型可用」或为什么没有（没有可用的、或可用的都没打开路由）。 */
export function capabilityLine(view: ModelCapabilitiesView, capability: OnlineCapability, routing: ModelApiRouting): string {
  const n = routableModelCount(view, capability, routing);
  if (n) return M.modelsAvailable(n);
  const usable = providers(view, capability).some((p) => p.available && p.models.some((m) => m.available !== false));
  return usable ? M.notRouted : M.noModels;
}

export interface AliasView {
  alias: string;
  capability: string;
  target: string;
  /** 外部程序此刻能不能用这个名字；不能时 `why` 说原因（Runtime 不检查，请求时回答 404 或 503）。 */
  usable: boolean;
  why: string | null;
}

/** 别名表的一行：名字 → 能力 · Provider 与模型；目标不可用或没打开路由时说明。 */
export function aliasView(alias: ModelApiAlias, view: ModelCapabilitiesView | null, routing: ModelApiRouting): AliasView {
  const capability = CAPABILITY_LABEL[alias.capability];
  const provider = view ? providers(view, alias.capability).find((p) => p.providerId === alias.providerId) : undefined;
  const model = provider && alias.modelId !== null ? provider.models.find((m) => m.modelId === alias.modelId) : undefined;
  const providerName = provider?.label ?? alias.providerId;
  const modelName = alias.modelId === null ? M.defaultModel : (model?.label ?? alias.modelId);
  const target = M.target(providerName, modelName);
  if (!view) return { alias: alias.alias, capability, target, usable: true, why: null };
  if (!provider) return { alias: alias.alias, capability, target, usable: false, why: M.aliasProviderMissing };
  if (!routable(provider.kind, routing)) return { alias: alias.alias, capability, target, usable: false, why: M.aliasNotRouted };
  if (!provider.available) return { alias: alias.alias, capability, target, usable: false, why: M.aliasProviderUnavailable };
  const ok = alias.modelId === null ? provider.models.some((m) => m.available !== false) : !!model && model.available !== false;
  return { alias: alias.alias, capability, target, usable: ok, why: ok ? null : M.aliasModelUnavailable };
}

export interface AliasTargetOption {
  /** `<providerId>\u0000<modelId 或空>`：选项的键。 */
  key: string;
  providerId: string;
  modelId: string | null;
  label: string;
  /** 现在不能路由时的说明（选得了，只是请求会失败）。 */
  note: string | null;
}

/** 添加别名时的目标选项：每个 Provider 一项「默认模型」，再列它的各个模型。只列这种能力下的 Provider。 */
export function aliasTargets(view: ModelCapabilitiesView, capability: OnlineCapability, routing: ModelApiRouting): AliasTargetOption[] {
  const out: AliasTargetOption[] = [];
  for (const p of providers(view, capability)) {
    const note = !routable(p.kind, routing) ? M.targetNotRouted : !p.available ? M.targetUnavailable : null;
    out.push({ key: targetKey(p.providerId, null), providerId: p.providerId, modelId: null, label: M.target(p.label, M.defaultModel), note });
    for (const m of p.models) {
      out.push({
        key: targetKey(p.providerId, m.modelId),
        providerId: p.providerId,
        modelId: m.modelId,
        label: M.target(p.label, m.label),
        note: note ?? (m.available === false ? M.targetUnavailable : null),
      });
    }
  }
  return out;
}

export function targetKey(providerId: string, modelId: string | null): string {
  return `${providerId}\u0000${modelId ?? ''}`;
}

/** 别名名字的校验（与协议的 `modelApiAlias` 同规则）：字母或数字开头，只含字母、数字与 `. _ : -`，不超过 100 个字符。 */
export function aliasNameError(name: string, existing: readonly ModelApiAlias[]): string | null {
  const t = name.trim();
  if (!t) return M.aliasNameEmpty;
  if (t.includes('/')) return M.aliasNameSlash;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(t)) return M.aliasNameChars;
  if (existing.some((a) => a.alias === t)) return M.aliasNameTaken(t);
  return null;
}

/**
 * 不带客户端时 connectionInfo 用的令牌占位符（`rcServices.tokenPlaceholderGeneric`）。Runtime 按它自己的语言写，可能与界面
 * 语言不同（浏览器客户端），所以每种出货语言的写法都认。
 */
export function tokenPlaceholders(): string[] {
  const ref = { key: 'rcServices.tokenPlaceholderGeneric' };
  return [...new Set(LOCALES.map((locale) => formatRef(ref, '', locale)).filter(Boolean))];
}

/**
 * 连接信息片段（不带 `clientId` 取的那一份）里的占位符换成令牌明文：只在创建客户端的那一刻、只进剪贴板。
 * 带客户端名的占位符（`<名字 的令牌>`）名字里可能有任何字符，不去猜，所以要用不带客户端的那份。
 */
export function withToken(snippet: string, token: string): string {
  return tokenPlaceholders().reduce((text, placeholder) => text.split(placeholder).join(token), snippet);
}

/** 字节数 → 「256 MB」。 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
