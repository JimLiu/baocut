import {
  AGENT_PROVIDER_PREFIX,
  defineMessages,
  live,
  localizeText,
  ONLINE_CAPABILITIES,
  type ConfigureProviderRequest,
  type DeclaredModel,
  type ImageModelInfo,
  type ModelCapabilitiesView,
  type ModelInfoBase,
  type ModelRef,
  type ModelServiceCapability,
  type OnlineCapability,
  type ProviderCapabilityView,
  type ProviderConfigView,
  type ProviderRefreshStatus,
  type ProviderUnavailableReason,
  type SpeechModelInfo,
  type TextModelInfo,
  type TranscribeModelInfo,
} from '@baocut/protocol';
import type { ModelCategory } from './settings-nav.ts';
import { zhHans } from './models-cloud.zh-Hans.ts';
import { zhHant } from './models-cloud.zh-Hant.ts';
import { ja } from './models-cloud.ja.ts';
import { ko } from './models-cloud.ko.ts';
import { es } from './models-cloud.es.ts';
import { fr } from './models-cloud.fr.ts';
import { de } from './models-cloud.de.ts';
import { nl } from './models-cloud.nl.ts';
import { ptBR } from './models-cloud.pt-BR.ts';
import { it } from './models-cloud.it.ts';
import { ru } from './models-cloud.ru.ts';
import { pl } from './models-cloud.pl.ts';
import { tr } from './models-cloud.tr.ts';
import { vi } from './models-cloud.vi.ts';

/**
 * 模型 › 云端模型（设计稿 settings-cloud.jsx）：把 `models` 主题的能力视图折成这一页要画的东西。
 * 服务商的清单不写死，全从视图里来：内置的（OpenAI、Google Gemini、ElevenLabs）只在它有这种能力的档露面；
 * 自建的（`custom:<slug>`，OpenAI-compatible）每一档都露面——没声明这一档的模型时就地添加，沿用同一把密钥。
 */

export const CUSTOM_PROVIDER_PREFIX = 'custom:';
/** Runtime 认的自建服务商 slug（providers/online-source.ts）。 */
const CUSTOM_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** 能力分类 → 模型服务能力。音源分离、画面理解在 Runtime 里还没有对应的能力，为 null。 */
const CATEGORY_CAPABILITY: Partial<Record<ModelCategory, OnlineCapability>> = {
  asr: 'transcribe',
  tts: 'synthesizeSpeech',
  llm: 'generateText',
  image: 'generateImage',
};

export function categoryCapability(category: ModelCategory): OnlineCapability | null {
  return CATEGORY_CAPABILITY[category] ?? null;
}

/** 模型服务能力 → 它所在的能力分类（加了别的用途的模型后跳到那一类）。 */
export function capabilityCategory(capability: ModelServiceCapability): ModelCategory {
  switch (capability) {
    case 'transcribe':
      return 'asr';
    case 'synthesizeSpeech':
      return 'tts';
    case 'generateImage':
      return 'image';
    case 'generateText':
      return 'llm';
    case 'separateAudio':
      return 'sep';
  }
}

/** 这一页的文案（英文是键与类型的来源，译文在 `models-cloud.<语言>.ts`）。 */
const en = {
  /** 能力的短名（密钥说明、添加模型的用途分段）。 */
  capabilityShort: {
    transcribe: 'Speech recognition',
    synthesizeSpeech: 'Speech synthesis',
    generateImage: 'Image generation',
    generateText: 'Text generation',
  } as Record<OnlineCapability, string>,
  /** 自建服务商没声明这一档的模型。 */
  noModels: 'No models declared',
  /** 默认菜单里不可用的一项：名字后面写「不可用」（`unavailable` 由调用方给）。 */
  unavailableItem: (label: string, unavailable: string) => `${label} (${unavailable})`,
};

export type ModelsCloudMessages = typeof en;

const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/** 能力的短名（密钥说明、添加模型的用途分段）。 */
export const CAPABILITY_SHORT: Record<OnlineCapability, string> = live(() => M.capabilityShort);

export function isCustomProvider(providerId: string): boolean {
  return providerId.startsWith(CUSTOM_PROVIDER_PREFIX);
}

export function isAgentProvider(providerId: string): boolean {
  return providerId.startsWith(AGENT_PROVIDER_PREFIX);
}

/**
 * 「已连接」：内置的要启用且有密钥；自建的要启用且有地址（密钥可以没有，本机或内网的服务常常不要）。
 * 与「可用」不同：自建的连上了，但这一档没声明模型时这一档仍不可用。
 */
export function providerConnected(providerId: string, config: ProviderConfigView | null): boolean {
  if (!config?.enabled) return false;
  return isCustomProvider(providerId) ? !!config.endpoint : config.credential === 'set';
}

/** 一张服务商卡。 */
export interface CloudProviderCard {
  providerId: string;
  label: string;
  custom: boolean;
  connected: boolean;
  /** 自建服务商的地址（内置的改写过基址时也有）。 */
  endpoint: string | null;
  /** 这一档下的模型；自建的没声明这一档时为空。 */
  models: ModelInfoBase[];
  /** 这家在各档提供的能力（密钥对话框写「这把密钥给哪几类用」）。自建的只算声明了模型的档。 */
  capabilities: OnlineCapability[];
  /** 这一档此刻能不能用、为什么。 */
  available: boolean;
  unavailableReason?: ProviderUnavailableReason;
  /** 不能用的原因：已经按界面当前语言生成（Runtime 的 `detail` / `detailRef`）。 */
  detail?: string;
  /** 最近一次「刷新」（`models.refreshProvider`）的结果；从没刷新过时没有。 */
  refreshed?: ProviderRefreshStatus;
}

function onlineProviders(view: ModelCapabilitiesView, capability: OnlineCapability): ProviderCapabilityView[] {
  return view[capability].providers.filter((p) => p.kind === 'online');
}

/** 这家在各档提供的能力。 */
function capabilitiesOf(view: ModelCapabilitiesView, providerId: string): OnlineCapability[] {
  const custom = isCustomProvider(providerId);
  return ONLINE_CAPABILITIES.filter((capability) => {
    const entry = view[capability].providers.find((p) => p.providerId === providerId);
    return !!entry && (!custom || entry.models.length > 0);
  });
}

/**
 * 这一档的服务商卡：内置的按视图顺序，自建的跟在后面（按 ID）；已连接的排前面。
 * 自建的在三种能力的视图里各找一遍再合并——它只出现在声明了模型的能力里（一个都没声明时只在语音识别里）。
 */
export function cloudProviders(view: ModelCapabilitiesView, capability: OnlineCapability): CloudProviderCard[] {
  const here = onlineProviders(view, capability);
  const builtins = here.filter((p) => !isCustomProvider(p.providerId));
  const customs = new Map<string, ProviderCapabilityView>();
  for (const cap of ONLINE_CAPABILITIES) {
    for (const p of onlineProviders(view, cap)) {
      if (isCustomProvider(p.providerId) && !customs.has(p.providerId)) customs.set(p.providerId, p);
    }
  }
  const cards = [
    ...builtins,
    ...[...customs.values()].sort((a, b) => a.providerId.localeCompare(b.providerId)),
  ].map((p): CloudProviderCard => {
    const entry = here.find((x) => x.providerId === p.providerId);
    const card: CloudProviderCard = {
      providerId: p.providerId,
      label: p.label,
      custom: isCustomProvider(p.providerId),
      connected: providerConnected(p.providerId, p.config),
      endpoint: p.config?.endpoint ?? null,
      models: entry?.models ?? [],
      capabilities: capabilitiesOf(view, p.providerId),
      available: entry?.available ?? false,
    };
    const reason = entry ? entry.unavailableReason : 'not-configured';
    const detail = entry ? localizeText(entry.detail, entry.detailRef) : M.noModels;
    if (!card.available && reason) card.unavailableReason = reason;
    if (!card.available && detail) card.detail = detail;
    if (p.config?.refreshed) card.refreshed = p.config.refreshed;
    return card;
  });
  return [...cards.filter((c) => c.connected), ...cards.filter((c) => !c.connected)];
}

// ---- 刷新模型与音色目录 ----

/** 「刷新」刷的是什么：文本生成档是模型列表，语音合成档是音色目录。 */
export type RefreshKind = 'models' | 'voices';

/**
 * 卡头上那颗「刷新」在不在（设计稿 settings-cloud.jsx:318-321）：文本生成档刷新模型；语音合成档刷新音色目录，
 * OpenAI 的音色是固定的那几只，不露；语音识别与图像档没有。没连接时也露出来（置灰），让人知道连上以后能刷新。
 * 一次 `models.refreshProvider` 模型与音色一起取，这里只决定按钮叫什么、说明行怎么写。
 */
export function refreshKind(card: Pick<CloudProviderCard, 'providerId' | 'custom' | 'models'>, capability: OnlineCapability): RefreshKind | null {
  if (capability === 'generateText') return card.custom || card.models.length > 0 ? 'models' : null;
  if (capability === 'synthesizeSpeech') return card.providerId === 'openai' ? null : 'voices';
  return null;
}

/** 卡头说明行里与刷新有关的那一段（设计稿 `headDesc` / `modelsLine` / `voicesLine`）。 */
export type RefreshLine =
  | { state: 'refreshing'; kind: RefreshKind }
  | { state: 'failed'; kind: RefreshKind; error: string }
  | { state: 'builtin'; kind: RefreshKind; models: number; voices: number }
  | { state: 'fresh'; kind: RefreshKind; models: number; voices: number; unusable: number; at: string };

/** 这一档的模型里出现过的音色（去重）。 */
export function voiceCount(models: readonly ModelInfoBase[]): number {
  const ids = new Set<string>();
  for (const model of models) for (const voice of (model as SpeechModelInfo).voices ?? []) ids.add(voice.voiceId);
  return ids.size;
}

/**
 * 连上了、这一档有刷新的卡的说明：正在刷新；刷新失败（原因不含密钥，Runtime 已经回到内置列表）；没刷新过（内置列表）；
 * 刷新过（几个模型、几只音色、多久前；内置模型不在取到的列表里的，Runtime 标成不可用，这里数出来）。其余返回 null，照旧写模型数。
 */
export function refreshLine(card: CloudProviderCard, capability: OnlineCapability, refreshing: boolean): RefreshLine | null {
  const kind = refreshKind(card, capability);
  if (!kind || !card.connected || !card.models.length) return null;
  if (refreshing) return { state: 'refreshing', kind };
  const refreshed = card.refreshed;
  if (refreshed && !refreshed.ok) return { state: 'failed', kind, error: refreshed.error ?? '' };
  const counts = { models: card.models.length, voices: voiceCount(card.models) };
  if (!refreshed) return { state: 'builtin', kind, ...counts };
  return { state: 'fresh', kind, ...counts, unusable: card.models.filter((m) => m.available === false).length, at: refreshed.at };
}

/** 保存密钥之后顺手刷新一次的服务商（设计稿 settings-cloud.jsx:394）：自建的，或这家有文本生成模型。 */
export function refreshAfterKey(card: Pick<CloudProviderCard, 'custom' | 'capabilities'>): boolean {
  return card.custom || card.capabilities.includes('generateText');
}

// ---- 自建服务商声明的模型 ----

function withLabel(info: ModelInfoBase): Pick<DeclaredModel, 'modelId' | 'label'> {
  return info.label && info.label !== info.modelId ? { modelId: info.modelId, label: info.label } : { modelId: info.modelId };
}

/** 视图里的一只模型 → 声明（`models.configure` 的 `models` 是整体替换，加一只要把原有的原样带上）。 */
export function declaredFromInfo(capability: OnlineCapability, info: ModelInfoBase): DeclaredModel {
  switch (capability) {
    case 'transcribe': {
      const m = info as TranscribeModelInfo;
      return {
        ...withLabel(m),
        capability,
        ...(m.maxInputBytes !== null ? { maxInputBytes: m.maxInputBytes } : {}),
        maxDurationSec: m.maxDurationSec,
        wordTimestamps: m.wordTimestamps,
        acceptsHint: m.acceptsHint,
      };
    }
    case 'synthesizeSpeech': {
      const m = info as SpeechModelInfo;
      return {
        ...withLabel(m),
        capability,
        voices: m.voices.map((v) => v.voiceId),
        maxInputChars: m.maxInputChars,
        formats: [...m.formats],
      };
    }
    case 'generateImage': {
      const m = info as ImageModelInfo;
      return { ...withLabel(m), capability, sizes: [...m.sizes], maxCount: m.maxCount, maxPromptChars: m.maxPromptChars };
    }
    case 'generateText': {
      const m = info as TextModelInfo;
      return {
        ...withLabel(m),
        capability,
        contextTokens: m.contextTokens,
        maxOutputTokens: m.maxOutputTokens,
        efforts: [...m.efforts],
        structuredOutput: m.structuredOutput,
      };
    }
  }
}

/** 一家自建服务商眼下声明的全部模型（三种能力合起来）。 */
export function declaredModels(view: ModelCapabilitiesView, providerId: string): DeclaredModel[] {
  const out: DeclaredModel[] = [];
  for (const capability of ONLINE_CAPABILITIES) {
    const entry = view[capability].providers.find((p) => p.providerId === providerId);
    for (const info of entry?.models ?? []) out.push(declaredFromInfo(capability, info));
  }
  return out;
}

/** 逗号、顿号或空白分隔的音色 ID。 */
export function parseVoiceIds(text: string): string[] {
  return [...new Set(text.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean))];
}

/** 新声明的一只模型：只给 ID、用途与（语音合成的）音色，其余由 Runtime 取保守默认。 */
export function newDeclaredModel(modelId: string, capability: OnlineCapability, voiceIds = ''): DeclaredModel {
  const voices = capability === 'synthesizeSpeech' ? parseVoiceIds(voiceIds) : [];
  return { modelId: modelId.trim(), capability, ...(voices.length ? { voices } : {}) };
}

/** 模型 ID 在这家已经声明过（Runtime 拒绝重复的 modelId，不分用途）。 */
export function modelIdTaken(view: ModelCapabilitiesView, providerId: string, modelId: string): boolean {
  const id = modelId.trim();
  return declaredModels(view, providerId).some((m) => m.modelId === id);
}

/** 在一家自建服务商下添加一只模型：原有声明原样带上，再加这一只。 */
export function addModelRequest(
  view: ModelCapabilitiesView,
  providerId: string,
  model: DeclaredModel,
): ConfigureProviderRequest {
  return { providerId, models: [...declaredModels(view, providerId), model] };
}

// ---- 添加自建服务商 ----

/** 服务地址查重用：去首尾空白与末尾斜杠，不分大小写（设计稿 normUrl）。 */
export function normalizeEndpoint(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

/** 像一个 http(s) 地址。 */
export function isEndpointUrl(url: string): boolean {
  const text = url.trim();
  if (!/^https?:\/\/[^\s/]+/i.test(text)) return false;
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

/** 这个地址已经加成了哪家自建服务商（在它下面加模型就能沿用同一把密钥）。 */
export function endpointOwner(view: ModelCapabilitiesView, url: string): { providerId: string; label: string } | null {
  const key = normalizeEndpoint(url);
  if (!key) return null;
  for (const capability of ONLINE_CAPABILITIES) {
    for (const p of view[capability].providers) {
      if (isCustomProvider(p.providerId) && p.config?.endpoint && normalizeEndpoint(p.config.endpoint) === key) {
        return { providerId: p.providerId, label: p.label };
      }
    }
  }
  return null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 名字里取不出 slug（例如全是中文）时用地址的主机名：去掉 api. / www. 与顶级域。 */
function slugFromUrl(url: string): string {
  try {
    const { hostname, port } = new URL(url.trim());
    const labels = hostname.split('.').filter((l) => l && l !== 'api' && l !== 'www');
    const host = labels.length > 1 && !/^\d+$/.test(labels[labels.length - 1]!) ? labels.slice(0, -1) : labels;
    return slugify([...host, port].filter(Boolean).join('-'));
  } catch {
    return '';
  }
}

/** 自建服务商的 ID `custom:<slug>`：先用名字，取不出时用地址；撞上已有的就加 -2、-3。 */
export function customProviderId(name: string, url: string, taken: ReadonlySet<string>): string {
  const base = (slugify(name) || slugFromUrl(url) || 'provider').slice(0, 56).replace(/-+$/, '') || 'provider';
  const first = CUSTOM_SLUG.test(base) ? base : `p-${base}`.slice(0, 56);
  let slug = first;
  for (let n = 2; taken.has(`${CUSTOM_PROVIDER_PREFIX}${slug}`); n++) slug = `${first}-${n}`;
  return `${CUSTOM_PROVIDER_PREFIX}${slug}`;
}

/** 视图里出现过的全部 Provider ID。 */
export function knownProviderIds(view: ModelCapabilitiesView): Set<string> {
  return new Set(ONLINE_CAPABILITIES.flatMap((c) => view[c].providers.map((p) => p.providerId)));
}

export interface CustomProviderDraft {
  name: string;
  url: string;
  modelId: string;
  capability: OnlineCapability;
  voiceIds: string;
}

/** 添加对话框能不能提交。 */
export function customDraftReady(draft: CustomProviderDraft): boolean {
  return draft.name.trim() !== '' && draft.modelId.trim() !== '' && isEndpointUrl(draft.url);
}

/**
 * 添加自建服务商：只登记名字、地址与第一只模型，不启用——连接（填密钥或留空、验证）之后才启用，
 * 与设计稿「添加后连接密钥并测试模型」一致。
 */
export function customProviderRequest(view: ModelCapabilitiesView, draft: CustomProviderDraft): ConfigureProviderRequest {
  return {
    providerId: customProviderId(draft.name, draft.url, knownProviderIds(view)),
    label: draft.name.trim(),
    endpoint: draft.url.trim().replace(/\/+$/, ''),
    models: [newDeclaredModel(draft.modelId, draft.capability, draft.voiceIds)],
  };
}

// ---- 密钥 ----

/** 保存密钥：启用并验证一次（只读请求，不过不存）。自建的可以不填密钥，只启用并验证地址。 */
export function connectRequest(providerId: string, key: string): ConfigureProviderRequest {
  const credential = key.trim();
  return { providerId, enabled: true, verify: true, ...(credential ? { credential } : {}) };
}

/** 内置服务商「移除密钥」：清掉密钥并停用。指向它的默认值由 Runtime 保留、报告为不可用。 */
export function disconnectRequest(providerId: string): ConfigureProviderRequest {
  return { providerId, enabled: false, credential: null };
}

// ---- 默认模型 ----

/** Picker 的键：`providerId/modelId`（providerId 里没有 `/`，modelId 里可能有），没有默认为 `none`。 */
export const NO_DEFAULT = 'none';

export function defaultKey(ref: ModelRef | null): string {
  return ref ? `${ref.providerId}/${ref.modelId}` : NO_DEFAULT;
}

export function parseDefaultKey(key: string): ModelRef | null {
  if (key === NO_DEFAULT) return null;
  const at = key.indexOf('/');
  return at > 0 ? { providerId: key.slice(0, at), modelId: key.slice(at + 1) } : null;
}

export interface DefaultOption {
  key: string;
  label: string;
  description?: string;
}

export interface DefaultSection {
  key: string;
  /** 分组标题（服务商名）；「每次选择」那一组没有。 */
  title?: string;
  items: DefaultOption[];
}

export interface CodexDefaultState {
  /** `agent:codex` 此刻能画。 */
  ready: boolean;
  /** 不能画时的一句原因。 */
  why: string | null;
}

export interface CloudDefaultPicker {
  selectedKey: string;
  sections: DefaultSection[];
  /** 没有能选的云端模型（只剩「每次选择」）。 */
  empty: boolean;
}

/** 本机或局域网节点的 Provider（不在云端页的菜单里）。视图里找不到（例如删掉的自建服务商）时按 ID 判断。 */
export function isLocalProvider(view: ModelCapabilitiesView, capability: OnlineCapability, providerId: string): boolean {
  const kind = view[capability].providers.find((p) => p.providerId === providerId)?.kind;
  return kind ? kind === 'local' || kind === 'node' : providerId === 'local' || providerId.startsWith('node:');
}

/** 当前默认值的显示名：能找到模型就用服务商名 + 模型 ID。 */
function refLabel(view: ModelCapabilitiesView, capability: OnlineCapability, ref: ModelRef): string {
  const provider = view[capability].providers.find((p) => p.providerId === ref.providerId);
  return `${provider?.label ?? ref.providerId} · ${ref.modelId}`;
}

/**
 * 云端页的默认模型菜单：第一项是「不设默认」，然后每家能用的在线服务商一组；图像档在 Codex 能画、或它已是默认时
 * 多一项「Codex CLI · 画图」。当前默认指向的服务商不可用时照样列出来、勾着、写「不可用」——Runtime 保留它，这里不替用户清。
 *
 * 每种能力只有一个默认值，本地页与云端页共用。语音识别的默认是本机或节点的模型时，云端页勾「用本地模型」，再选它不动默认。
 * 其余能力没有出厂默认：默认是本机或节点的模型时单列一项、勾着它（写明在本地模型页设的），「每次选择」才是真的清掉默认。
 */
export function cloudDefaultPicker(
  view: ModelCapabilitiesView,
  capability: OnlineCapability,
  codex: CodexDefaultState | null,
  copy: { none: string; noneDesc: string; codex: string; codexDesc: string; unavailable: string; localDesc?: string },
): CloudDefaultPicker {
  const current = view[capability].default;
  const local = !!current && isLocalProvider(view, capability, current.providerId);
  const selectedKey = current && (!local || capability !== 'transcribe') ? defaultKey(current) : NO_DEFAULT;
  // 分组与选项在同一个集合里，分组的 key 不能与任何选项的 key 相同（`none` 曾撞上 NO_DEFAULT，菜单整页崩掉）。
  const sections: DefaultSection[] = [{ key: 'no-default', items: [{ key: NO_DEFAULT, label: copy.none, description: copy.noneDesc }] }];
  let listedCurrent = selectedKey === NO_DEFAULT;
  if (current && local && capability !== 'transcribe') {
    const provider = view[capability].providers.find((p) => p.providerId === current.providerId);
    const model = provider?.models.find((m) => m.modelId === current.modelId);
    const label = `${provider?.label ?? current.providerId} · ${model?.label ?? current.modelId}`;
    sections.push({ key: 'local-default', items: [{ key: selectedKey, label, ...(copy.localDesc ? { description: copy.localDesc } : {}) }] });
    listedCurrent = true;
  }
  for (const p of onlineProviders(view, capability)) {
    if (!p.available || !p.models.length) continue;
    const items = p.models.map((m) => ({ key: defaultKey({ providerId: p.providerId, modelId: m.modelId }), label: m.modelId }));
    if (items.some((i) => i.key === selectedKey)) listedCurrent = true;
    sections.push({ key: p.providerId, title: p.label, items });
  }
  const empty = sections.length === 1;
  if (capability === 'generateImage' && codex) {
    const codexKey = defaultKey({ providerId: `${AGENT_PROVIDER_PREFIX}codex`, modelId: 'image-gen' });
    const isDefault = selectedKey === codexKey;
    if (codex.ready || isDefault) {
      sections.push({
        key: 'codex',
        items: [
          {
            key: codexKey,
            label: codex.ready ? copy.codex : M.unavailableItem(copy.codex, copy.unavailable),
            description: codex.ready ? copy.codexDesc : (codex.why ?? undefined),
          },
        ],
      });
      if (isDefault) listedCurrent = true;
    }
  }
  if (!listedCurrent && current) {
    sections.push({ key: 'current', items: [{ key: selectedKey, label: M.unavailableItem(refLabel(view, capability, current), copy.unavailable) }] });
  }
  return { selectedKey, sections, empty: empty && !(capability === 'generateImage' && codex?.ready) };
}
