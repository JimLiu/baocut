import {
  CREDENTIAL_UNAVAILABLE,
  modelDetail,
  ProviderFailure,
  type DescribeMode,
  type GenerationCapability,
  type GenerationProvider,
  type ModelServiceStore,
  type DiscoveredList,
  type ProviderQueue,
  type ProviderSource,
  type StoredAccount,
  type TextProvider,
  type TranscribeProvider,
  type UsageLedger,
} from '@baocut/models';
import {
  RpcError,
  type AddProviderAccountRequest,
  type ArrangeProviderAccountsRequest,
  type ConfigureProviderRequest,
  type Localized,
  type ModelInfoBase,
  type ModelServiceCapability,
  type ProviderCapabilities,
  type ProviderCapability,
  type ProviderRefreshStatus,
  type ProviderUnavailableReason,
  type ProviderView,
  type ProviderVendorInfo,
  type SpeechModelInfo,
  type UpdateProviderAccountRequest,
  type UsageRecord,
} from '@baocut/protocol';
import type {
  AdapterConfig,
  AdapterHttp,
  ImageAdapter,
  ModelLister,
  SpeechAdapter,
  TextAdapter,
  TranscribeAdapter,
  VoiceCloneAdapter,
} from './adapter.ts';
import { ANTHROPIC_DEFAULT_BASE_URL, AnthropicTextAdapter } from './anthropic/anthropic-text.ts';
import type { FfmpegResolver } from './audio/audio-prep.ts';
import { ELEVENLABS_DEFAULT_BASE_URL, ElevenLabsAdapter } from './elevenlabs/elevenlabs-adapter.ts';
import { ElevenLabsVoiceCloneAdapter } from './elevenlabs/elevenlabs-voice-clone.ts';
import { GOOGLE_DEFAULT_BASE_URL, GoogleAdapter } from './google/google-adapter.ts';
import { GoogleImageAdapter } from './google/google-image.ts';
import { GoogleTextAdapter } from './google/google-text.ts';
import { redact } from './http/provider-fetch.ts';
import { OnlineGenerator } from './online-generator.ts';
import { OnlineTextProvider } from './online-text.ts';
import { OnlineTranscriber } from './online-transcriber.ts';
import { CompatibleAdapter, declaredOf } from './openai-compatible/compatible-adapter.ts';
import { CompatibleImageAdapter, CompatibleSpeechAdapter } from './openai-compatible/compatible-media.ts';
import { CompatibleTextAdapter } from './openai-compatible/compatible-text.ts';
import { VendorTextAdapter } from './openai-compatible/vendor-text.ts';
import { OPENAI_DEFAULT_BASE_URL, OpenAiAdapter } from './openai/openai-adapter.ts';
import { OpenAiImageAdapter, OpenAiSpeechAdapter } from './openai/openai-media-adapters.ts';
import { OpenAiTextAdapter } from './openai/openai-text.ts';
import { accountStatusOf, usageErrorOf, type CallReporter } from './usage-reporter.ts';
import { COMPAT_VENDOR_IDS, COMPAT_VENDORS, type CompatVendorId } from './vendor-catalog.ts';
import { ProvidersConfig as PC, ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

/**
 * 在线 Provider 来源（架构设计 §6.4）：服务商目录里的内置服务商与用户添加的 OpenAI 兼容端点 `custom:<slug>`。
 *
 * - 能力：`openai` 有 transcribe、synthesizeSpeech、generateImage、generateText；`google` 有 transcribe、generateImage、
 *   generateText；`elevenlabs` 只有 synthesizeSpeech；`anthropic`（Messages 原生适配器）与目录里的兼容文本服务商
 *   （`vendor-catalog.ts`）只有 generateText（目录标 P1 的能力不报告）。自定义端点按声明的模型的 `capability` 提供
 *   （一个模型也没声明时只列 transcribe）。
 * - 账号（§6.8）：一次调用用第一个启用且有密钥的账号，失败不换账号；调用结束时写一条用量（§6.10）并按结果记下那个
 *   账号的状态。基址：账号的改写优先，其次是服务商的端点，最后是目录的预设（有国际与中国两个基址的按账号的 `region`）。
 * - `refresh()`（`models.refreshProvider`）向供应商取模型（与音色）列表，记在配置里：取到的列表只用来标注内置的模型——
 *   不在列表里的报告为不可用（`unsupported`），账号里的音色补进没有预置音色的语音模型；取不到时照旧用内置列表并标明。
 * - 可用 = 用户启用了它（启用即是持续的授权，§6.2）且有密钥；自定义端点密钥可选，但那种能力要声明了模型。
 * - 配置与密钥在 `ModelServiceStore` 里；这里的视图只报告密钥有没有，从不回显。密钥在执行时才从凭据存储取；
 *   凭据存储不可用时 Provider 报告为不可用（`missing-credential`，`detail` 写明原因），不回退到别的存放。
 * - 每个 Provider 一个队列（各种能力共用），默认同时运行 2 个任务；`generateText` 另有自己的并发上限（能力参数，§6.8）。
 * - 选择与执行都不联网；只有 `models.configure` 带 `verify: true` 与 `models.refreshProvider` 时向供应商发只读请求。
 */

export interface OnlineSourceOptions {
  store: ModelServiceStore;
  ffmpeg: FfmpegResolver;
  /** 改写内置 Provider 的默认基址（测试指向本机的假服务）。用户在配置里改写的端点优先。 */
  baseUrls?: Partial<Record<BuiltinId, string>>;
  /** 每个 Provider 同时运行的任务数（默认 2）。 */
  concurrency?: number;
  /** 请求的调节项（测试注入更短的退避）。 */
  http?: AdapterHttp;
  /** 用量账本（§6.10）；不给时不记用量（账号状态照样记）。 */
  usage?: UsageLedger;
}

type BuiltinId = 'openai' | 'google' | 'elevenlabs' | 'anthropic' | CompatVendorId;

/** 一个 Provider 上的音色克隆（`voiceCloner()`）：密钥在执行时取，不经调用方。 */
export interface VoiceCloner {
  providerId: string;
  label: string;
  /** 适配器的版本（记在任务的告警与日志里）。 */
  version: string;
  /** 此刻启用着且有密钥。 */
  available(): boolean;
  create(input: {
    name: string;
    file: string;
    fileName: string;
    mediaType: string;
    description: string | null;
    signal: AbortSignal;
  }): Promise<{ voiceId: string }>;
  remove(voiceId: string, signal: AbortSignal): Promise<'deleted' | 'not-found'>;
}

/** 用这份配置向供应商发一个只读请求（`models.configure` 带 `verify: true`）。 */
interface CredentialValidator {
  validateCredential(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<void>;
}

/** 一个 Provider 的各种能力的适配器；没有那种能力时 null。 */
interface AdapterSet {
  transcribe: TranscribeAdapter | null;
  speech: SpeechAdapter | null;
  image: ImageAdapter | null;
  text: TextAdapter | null;
  validator: CredentialValidator;
  /** `models.refreshProvider` 用：列出供应商的模型（与音色）。 */
  lister: ModelLister;
  /** 音色克隆（§5.9）：只有真的提供克隆接口的供应商才有。 */
  clone?: VoiceCloneAdapter;
}

interface BuiltinEntry {
  label: string;
  /** 缺省的基址（有地区的服务商是第一个地区的）。 */
  baseUrl: string;
  /** 地区 → 基址（只有国际与中国两个基址的服务商有）。 */
  regions?: Record<string, string>;
  vendor: ProviderVendorInfo;
  adapters: () => AdapterSet;
}

function compatEntry(id: CompatVendorId): BuiltinEntry {
  const entry = COMPAT_VENDORS[id];
  const regions = Object.keys(entry.regions);
  return {
    // 读取时取：名字随界面语言。
    get label() {
      return entry.label;
    },
    baseUrl: entry.regions[regions[0]!]!,
    ...(regions.length > 1 ? { regions: { ...entry.regions } } : {}),
    vendor: { ...entry.vendor },
    adapters: () => {
      const text = new VendorTextAdapter(entry);
      return { transcribe: null, speech: null, image: null, text, validator: text, lister: text };
    },
  };
}

const BUILTINS: Record<BuiltinId, BuiltinEntry> = {
  openai: {
    label: 'OpenAI',
    baseUrl: OPENAI_DEFAULT_BASE_URL,
    vendor: { kind: 'vendor', website: 'https://platform.openai.com', icon: 'openai' },
    adapters: () => {
      const transcribe = new OpenAiAdapter();
      const text = new OpenAiTextAdapter();
      return {
        transcribe,
        speech: new OpenAiSpeechAdapter(),
        image: new OpenAiImageAdapter(),
        text,
        validator: transcribe,
        lister: text,
      };
    },
  },
  google: {
    label: 'Google Gemini',
    baseUrl: GOOGLE_DEFAULT_BASE_URL,
    vendor: { kind: 'vendor', website: 'https://aistudio.google.com', icon: 'google' },
    adapters: () => {
      const transcribe = new GoogleAdapter();
      const text = new GoogleTextAdapter();
      return { transcribe, speech: null, image: new GoogleImageAdapter(), text, validator: transcribe, lister: text };
    },
  },
  elevenlabs: {
    label: 'ElevenLabs',
    baseUrl: ELEVENLABS_DEFAULT_BASE_URL,
    vendor: { kind: 'vendor', website: 'https://elevenlabs.io', icon: 'elevenlabs' },
    adapters: () => {
      const speech = new ElevenLabsAdapter();
      return {
        transcribe: null,
        speech,
        image: null,
        text: null,
        validator: speech,
        lister: speech,
        clone: new ElevenLabsVoiceCloneAdapter(),
      };
    },
  },
  anthropic: {
    label: 'Anthropic',
    baseUrl: ANTHROPIC_DEFAULT_BASE_URL,
    vendor: { kind: 'vendor', website: 'https://platform.claude.com', icon: 'anthropic' },
    adapters: () => {
      const text = new AnthropicTextAdapter();
      return { transcribe: null, speech: null, image: null, text, validator: text, lister: text };
    },
  },
  ...(Object.fromEntries(COMPAT_VENDOR_IDS.map((id) => [id, compatEntry(id)])) as Record<CompatVendorId, BuiltinEntry>),
};

export const CUSTOM_PREFIX = 'custom:';
export const CUSTOM_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const VERIFY_TIMEOUT_MS = 20_000;
const REFRESH_TIMEOUT_MS = 30_000;

export class OnlineProviderSource implements ProviderSource {
  readonly kind = 'online' as const;
  readonly #options: OnlineSourceOptions;
  readonly #store: ModelServiceStore;
  readonly #adapters = new Map<string, AdapterSet>();
  readonly #transcribers = new Map<string, OnlineTranscriber>();
  readonly #generators = new Map<string, OnlineGenerator>();
  readonly #texts = new Map<string, OnlineTextProvider>();

  constructor(options: OnlineSourceOptions) {
    this.#options = options;
    this.#store = options.store;
  }

  owns(providerId: string): boolean {
    return isBuiltin(providerId) || providerId.startsWith(CUSTOM_PREFIX);
  }

  resolve(providerId: string): string | null {
    if (isBuiltin(providerId)) return providerId;
    return providerId.startsWith(CUSTOM_PREFIX) && this.#store.provider(providerId) ? providerId : null;
  }

  async list(_mode: DescribeMode): Promise<ProviderView[]> {
    const custom = this.#store
      .providerIds()
      .filter((id) => id.startsWith(CUSTOM_PREFIX))
      .sort();
    return [...Object.keys(BUILTINS), ...custom].map((id) => this.#describe(id)!);
  }

  async describe(providerId: string, _mode: DescribeMode): Promise<ProviderView | null> {
    return this.resolve(providerId) ? this.#describe(providerId) : null;
  }

  transcriber(providerId: string): TranscribeProvider | null {
    if (!this.resolve(providerId)) return null;
    const adapter = this.#adapterSet(providerId).transcribe;
    if (!adapter) return null;
    let transcriber = this.#transcribers.get(providerId);
    if (!transcriber) {
      transcriber = new OnlineTranscriber({
        providerId,
        label: this.#label(providerId),
        adapter,
        // 执行时再读一次配置：排队期间被停用或删掉密钥的，不再发出请求。
        config: async () => (this.#availability(providerId, 'transcribe').available ? this.#config(providerId) : null),
        report: this.#reporter(providerId),
        ffmpeg: this.#options.ffmpeg,
        ...(this.#options.http ? { http: this.#options.http } : {}),
      });
      this.#transcribers.set(providerId, transcriber);
    }
    return transcriber;
  }

  textProvider(providerId: string): TextProvider | null {
    if (!this.resolve(providerId)) return null;
    const adapter = this.#adapterSet(providerId).text;
    if (!adapter) return null;
    let provider = this.#texts.get(providerId);
    if (!provider) {
      provider = new OnlineTextProvider({
        providerId,
        label: () => this.#label(providerId),
        adapter,
        // 执行时再读一次配置：排队期间被停用或删掉密钥的，不再发出请求。
        config: async () => (this.#availability(providerId, 'generateText').available ? this.#config(providerId) : null),
        report: this.#reporter(providerId),
        ...(this.#options.http ? { http: this.#options.http } : {}),
      });
      this.#texts.set(providerId, provider);
    }
    return provider;
  }

  generator(providerId: string, capability: GenerationCapability): GenerationProvider | null {
    if (!this.resolve(providerId)) return null;
    // 文本生成的任务执行者由 ModelServices 用 `textProvider()` 组装（与进程内调用共用并发上限）。
    if (capability === 'generateText') return null;
    const adapters = this.#adapterSet(providerId);
    if (!(capability === 'synthesizeSpeech' ? adapters.speech : adapters.image)) return null;
    let generator = this.#generators.get(providerId);
    if (!generator) {
      generator = new OnlineGenerator({
        providerId,
        label: () => this.#label(providerId),
        speech: adapters.speech,
        image: adapters.image,
        // 执行时再读一次配置：排队期间被停用或删掉密钥的，不再发出请求。
        config: async () => (this.#availability(providerId).available ? this.#config(providerId) : null),
        report: this.#reporter(providerId),
        ...(this.#options.http ? { http: this.#options.http } : {}),
      });
      this.#generators.set(providerId, generator);
    }
    return generator;
  }

  /**
   * 一个 Provider 的音色克隆（§5.9）：没有克隆接口的供应商（`openai`、`google`、自定义端点）返回 null。
   * 执行时再读一次配置：没有启用或没有密钥时以 `unavailable` 失败，不发出请求。
   */
  voiceCloner(providerId: string): VoiceCloner | null {
    if (!this.resolve(providerId)) return null;
    const adapter = this.#adapterSet(providerId).clone;
    if (!adapter) return null;
    const http = this.#options.http ?? {};
    const config = async () => {
      const availability = this.#availability(providerId);
      if (!availability.available) {
        throw new ProviderFailure('unavailable', PC.unavailableNow({ label: this.#label(providerId), detail: availability.detail ?? PC.notEnabled() }).text, {
          code: 'CAPABILITY_NOT_CONFIGURED',
          providerId,
        });
      }
      return this.#config(providerId);
    };
    return {
      providerId,
      label: this.#label(providerId),
      version: adapter.version,
      available: () => this.#availability(providerId).available,
      create: async (input) => adapter.createVoiceClone({ ...input, config: await config(), http }),
      remove: async (voiceId, signal) => adapter.deleteVoiceClone({ voiceId, signal, config: await config(), http }),
    };
  }

  generators(): GenerationProvider[] {
    return [...this.#generators.values()];
  }

  queue(providerId: string, _modelId: string): ProviderQueue {
    return { key: providerId, concurrency: this.#options.concurrency ?? 2 };
  }

  executors(): TranscribeProvider[] {
    return [...this.#transcribers.values()];
  }

  async configure(request: ConfigureProviderRequest): Promise<void> {
    const id = request.providerId;
    const custom = id.startsWith(CUSTOM_PREFIX);
    if (custom && !CUSTOM_SLUG.test(id.slice(CUSTOM_PREFIX.length))) {
      throw new RpcError('invalid-request', PC.customIdFormat());
    }
    if (!custom && !isBuiltin(id)) throw new RpcError('not-found', PC.providerNotFound({ id }));
    if (!custom && (request.models !== undefined || request.label !== undefined)) {
      throw new RpcError('invalid-request', PC.onlyCustomDeclares());
    }
    const stored = this.#store.provider(id);
    if (custom && !stored && !request.endpoint) throw new RpcError('invalid-request', PC.customNeedsEndpoint());
    if (custom && request.endpoint === null) throw new RpcError('invalid-request', PC.customEndpointRequired());
    if (request.models) {
      const ids = request.models.map((m) => m.modelId);
      if (new Set(ids).size !== ids.length) throw new RpcError('invalid-request', PC.duplicateModelIds());
    }

    if (request.verify) {
      // 没给新密钥时验证已保存的（第一个启用且有密钥的账号）；新密钥还没保存，用量记录的账号为 null。
      const saved = request.credential === undefined ? await this.#storedCredential(id) : null;
      const credential = request.credential === undefined ? (saved?.secret ?? null) : request.credential;
      if (!custom && !credential) throw new RpcError('invalid-request', PC.noKeyToVerify());
      const endpoint = request.endpoint === undefined ? stored?.endpoint : (request.endpoint ?? undefined);
      const account = saved ? stored?.accounts.find((a) => a.accountId === saved.accountId) : (stored?.accounts[0] ?? undefined);
      await this.#verify(
        {
          providerId: id,
          baseUrl: this.#baseUrl(id, endpoint, account),
          credential: credential ?? null,
          accountId: saved?.accountId ?? null,
          declared: request.models ?? stored?.models ?? [],
        },
        Boolean(saved),
      );
    }

    await this.#store.updateProvider(id, {
      ...(request.enabled !== undefined ? { enabled: request.enabled } : {}),
      ...(request.credential !== undefined ? { credential: request.credential } : {}),
      ...(request.endpoint !== undefined ? { endpoint: request.endpoint } : {}),
      ...(request.label !== undefined ? { label: request.label } : {}),
      ...(request.models !== undefined ? { models: request.models } : {}),
    });
  }

  /** `models.addAccount`（§6.8）：加在最后；带 `verify` 时先用新的密钥验证，不通过不保存。 */
  async addAccount(request: AddProviderAccountRequest): Promise<void> {
    const id = this.#accountProvider(request.providerId);
    this.#checkRegion(id, request.region);
    const stored = this.#store.provider(id);
    if (request.verify) {
      await this.#verify(
        {
          providerId: id,
          baseUrl: this.#baseUrl(id, stored?.endpoint, request),
          credential: request.credential,
          accountId: null,
          declared: stored?.models ?? [],
        },
        false,
      );
    }
    const accountId = await this.#store.addAccount(id, {
      credential: request.credential,
      ...(request.label !== undefined ? { label: request.label } : {}),
      ...(request.region !== undefined ? { region: request.region } : {}),
      ...(request.endpoint !== undefined ? { endpoint: request.endpoint } : {}),
    });
    if (request.verify) {
      const at = new Date().toISOString();
      this.#store.recordAccountResult(id, accountId, at, { state: 'ok', at });
    }
  }

  /**
   * `models.updateAccount`（§6.8）。带 `verify` 时先验证：换了密钥的验证新的密钥（还没保存），没换的验证这个账号已保存的
   * 密钥；用改后的 region 与端点。不通过不保存。
   */
  async updateAccount(request: UpdateProviderAccountRequest): Promise<void> {
    const id = this.#accountProvider(request.providerId);
    const stored = this.#store.provider(id);
    const account = stored?.accounts.find((a) => a.accountId === request.accountId);
    if (!account) {
      throw new RpcError('not-found', PC.accountNotFound({ provider: id, account: request.accountId }), {
        code: 'ACCOUNT_NOT_FOUND',
        providerId: id,
        accountId: request.accountId,
      });
    }
    if (request.region !== undefined && request.region !== null) this.#checkRegion(id, request.region);
    if (request.verify) {
      const credential = request.credential ?? (await this.#accountSecret(id, account.accountId));
      if (!credential) throw new RpcError('invalid-request', PC.accountNoKeyToVerify());
      const next = {
        ...(request.region === undefined ? (account.region ? { region: account.region } : {}) : request.region ? { region: request.region } : {}),
        ...(request.endpoint === undefined
          ? account.endpoint
            ? { endpoint: account.endpoint }
            : {}
          : request.endpoint
            ? { endpoint: request.endpoint }
            : {}),
      };
      await this.#verify(
        {
          providerId: id,
          baseUrl: this.#baseUrl(id, stored?.endpoint, next),
          credential,
          accountId: account.accountId,
          declared: stored?.models ?? [],
        },
        request.credential === undefined,
      );
    }
    await this.#store.updateAccount(id, account.accountId, {
      ...(request.label !== undefined ? { label: request.label } : {}),
      ...(request.credential !== undefined ? { credential: request.credential } : {}),
      ...(request.enabled !== undefined ? { enabled: request.enabled } : {}),
      ...(request.region !== undefined ? { region: request.region } : {}),
      ...(request.endpoint !== undefined ? { endpoint: request.endpoint } : {}),
    });
    if (request.verify && request.credential !== undefined) {
      const at = new Date().toISOString();
      this.#store.recordAccountResult(id, account.accountId, at, { state: 'ok', at });
    }
  }

  async removeAccount(providerId: string, accountId: string): Promise<void> {
    await this.#store.removeAccount(this.#accountProvider(providerId), accountId);
  }

  async arrangeAccounts(request: ArrangeProviderAccountsRequest): Promise<void> {
    await this.#store.arrangeAccounts(this.#accountProvider(request.providerId), request.order);
  }

  async refresh(providerId: string): Promise<ProviderRefreshStatus> {
    const id = this.resolve(providerId);
    if (!id) throw new RpcError('not-found', PC.providerNotFound({ id: providerId }));
    const stored = this.#store.provider(id);
    if (id.startsWith(CUSTOM_PREFIX) && !stored?.endpoint) throw new RpcError('invalid-request', PC.customNoEndpoint());
    if (!id.startsWith(CUSTOM_PREFIX) && !this.#store.hasCredential(id) && !this.#store.credentialProblem(id)) {
      throw new RpcError('invalid-request', PC.noKeySet({ label: this.#label(id) }));
    }
    const at = new Date().toISOString();
    let discovered: DiscoveredList;
    let secret: string | null = null;
    try {
      const config = await this.#config(id);
      secret = config.credential;
      const http = this.#options.http ?? {};
      const listing = await this.#adapterSet(id).lister.listModels(config, AbortSignal.timeout(REFRESH_TIMEOUT_MS), http);
      discovered = { at, ok: true, models: listing.models, ...(listing.voices ? { voices: listing.voices } : {}) };
    } catch (error) {
      // `ProviderFailure` 的文本已经去掉了密钥；别的错误也再去一次。
      const message = error instanceof Error ? error.message : String(error);
      discovered = { at, ok: false, error: redact(message, secret ? [secret] : []).slice(0, 500) };
    }
    return this.#store.setDiscovered(id, discovered);
  }

  /**
   * 移除服务商（§6.8）：自定义端点删除整个配置；目录里的服务商删掉配置（停用）与全部账号的凭据，回到没有添加的状态，
   * 没有配置过时什么也不做。指向它的默认值保留。
   */
  async remove(providerId: string): Promise<boolean> {
    if (!this.owns(providerId)) return false;
    // 执行者与适配器留着：它们每次都从配置里读端点、密钥与名字，删掉之后读不到配置，排队的任务不再发出请求。
    const removed = await this.#store.removeProvider(providerId);
    return removed || isBuiltin(providerId);
  }

  #describe(providerId: string): ProviderView {
    const config = this.#settings(providerId);
    const adapters = this.#adapterSet(providerId);
    const custom = providerId.startsWith(CUSTOM_PREFIX);
    const capabilities: ProviderCapabilities = {};
    const offer = <M extends ProviderCapability['models'][number]>(
      capability: ModelServiceCapability,
      models: M[],
    ): ProviderCapability<M> => {
      const { available, reason, detail } = this.#availability(providerId, capability);
      return { models, available, ...(reason ? { unavailableReason: reason } : {}), ...(detail ? modelDetail(detail) : {}) };
    };
    // 自定义端点只列声明了模型的能力；一个模型也没声明时列 transcribe（等着声明）。
    const declares = (capability: ModelServiceCapability) =>
      !custom || declaredOf(config, capability).length > 0 || (capability === 'transcribe' && config.declared.length === 0);
    if (adapters.transcribe && declares('transcribe')) capabilities.transcribe = offer('transcribe', adapters.transcribe.models(config));
    if (adapters.speech && declares('synthesizeSpeech')) {
      capabilities.synthesizeSpeech = offer('synthesizeSpeech', adapters.speech.models(config));
    }
    if (adapters.image && declares('generateImage')) capabilities.generateImage = offer('generateImage', adapters.image.models(config));
    if (adapters.text && declares('generateText')) capabilities.generateText = offer('generateText', adapters.text.models(config));
    const discovered = this.#store.provider(providerId)?.discovered;
    if (discovered?.ok) for (const cap of Object.values(capabilities)) annotate(cap.models, discovered);
    return {
      providerId,
      kind: 'online',
      label: this.#label(providerId),
      vendor: isBuiltin(providerId) ? structuredClone(BUILTINS[providerId].vendor) : { kind: 'custom' },
      config: this.#store.configView(providerId),
      capabilities,
    };
  }

  /** 不给 `capability` 时只看启用、端点与密钥（执行时用：模型是否声明由执行者按冻结的模型查）。 */
  #availability(
    providerId: string,
    capability?: ModelServiceCapability,
  ): { available: boolean; reason?: ProviderUnavailableReason; detail?: Localized } {
    const stored = this.#store.provider(providerId);
    if (!stored?.enabled) return { available: false, reason: 'not-configured', detail: PC.notEnabled() };
    const problem = this.#store.credentialProblem(providerId);
    if (problem) return { available: false, reason: 'missing-credential', detail: PC.credentialUnavailable({ problem }) };
    if (providerId.startsWith(CUSTOM_PREFIX)) {
      if (!stored.endpoint) return { available: false, reason: 'not-configured', detail: PC.noEndpointSet() };
      const declared = stored.models ?? [];
      const missing = capability ? !declared.some((m) => (m.capability ?? 'transcribe') === capability) : declared.length === 0;
      if (missing) return { available: false, reason: 'not-configured', detail: PC.noModelsDeclared() };
      return { available: true };
    }
    if (!this.#store.hasCredential(providerId)) return { available: false, reason: 'missing-credential', detail: PC.noKey() };
    return { available: true };
  }

  /** 不含密钥的配置：描述与列模型用（基址按第一个启用且有密钥的账号）。 */
  #settings(providerId: string): AdapterConfig {
    const stored = this.#store.provider(providerId);
    return {
      providerId,
      baseUrl: this.#baseUrl(providerId, stored?.endpoint, this.#store.activeAccount(providerId) ?? undefined),
      credential: null,
      declared: stored?.models ?? [],
    };
  }

  /** 执行用的配置：取第一个启用且有密钥的账号的密钥（§6.8）。取不到时以 `unavailable` 失败，原因里没有密钥。 */
  async #config(providerId: string): Promise<AdapterConfig> {
    let resolved: { accountId: string; secret: string } | null;
    try {
      resolved = await this.#store.resolveCredential(providerId);
    } catch {
      const reason = this.#store.credentialProblem(providerId) ?? PC.keyUnreadable().text;
      throw new ProviderFailure('unavailable', PC.labelCredentialUnavailable({ label: this.#label(providerId), problem: reason }).text, { providerId });
    }
    const stored = this.#store.provider(providerId);
    const account = resolved ? stored?.accounts.find((a) => a.accountId === resolved.accountId) : undefined;
    return {
      providerId,
      baseUrl: this.#baseUrl(providerId, stored?.endpoint, account),
      credential: resolved?.secret ?? null,
      accountId: resolved?.accountId ?? null,
      declared: stored?.models ?? [],
    };
  }

  /** `verify` 没有给新密钥时用已保存的；凭据存储不可用时以 `conflict`（`CREDENTIAL_UNAVAILABLE`）拒绝。 */
  async #storedCredential(providerId: string): Promise<{ accountId: string; secret: string } | null> {
    try {
      return await this.#store.resolveCredential(providerId);
    } catch {
      const reason = this.#store.credentialProblem(providerId) ?? PC.keyUnreadable().text;
      throw new RpcError('conflict', PC.credentialUnavailable({ problem: reason }), { code: CREDENTIAL_UNAVAILABLE, providerId });
    }
  }

  /** 一个账号已保存的密钥（验证用）；凭据存储不可用时以 `conflict`（`CREDENTIAL_UNAVAILABLE`）拒绝。 */
  async #accountSecret(providerId: string, accountId: string): Promise<string | null> {
    try {
      return await this.#store.accountCredential(providerId, accountId);
    } catch {
      const reason = this.#store.credentialProblem(providerId) ?? PC.keyUnreadable().text;
      throw new RpcError('conflict', PC.credentialUnavailable({ problem: reason }), { code: CREDENTIAL_UNAVAILABLE, providerId });
    }
  }

  /**
   * 连通性测试（§6.8）：用这份配置向供应商发一个只读请求（列模型）。写一条用量（`verify`，用量为空、不计费用）；验证的是
   * 已保存的密钥（`saved`）时按结果记下账号的状态。不通过时以 `conflict` 拒绝，`details.code` 是 `PROVIDER_*`。
   */
  async #verify(config: AdapterConfig, saved: boolean): Promise<void> {
    const startedAt = Date.now();
    let failure: unknown;
    try {
      await this.#adapterSet(config.providerId).validator.validateCredential(
        config,
        AbortSignal.timeout(VERIFY_TIMEOUT_MS),
        this.#options.http ?? {},
      );
    } catch (error) {
      failure = error;
    }
    const at = new Date().toISOString();
    this.#record({
      at,
      providerId: config.providerId,
      accountId: config.accountId ?? null,
      capability: null,
      modelId: null,
      source: 'verify',
      units: {},
      cost: { kind: 'unknown' },
      durationMs: Date.now() - startedAt,
      status: failure === undefined ? 'ok' : 'error',
      ...(failure !== undefined ? { error: usageErrorOf(failure) } : {}),
    });
    if (saved && config.accountId) this.#store.recordAccountResult(config.providerId, config.accountId, at, accountStatusOf(failure, at));
    if (failure === undefined) return;
    if (failure instanceof ProviderFailure) {
      const code = typeof failure.details.code === 'string' ? failure.details.code : 'PROVIDER_REJECTED';
      // `ProviderFailure` 的文本已经去掉了密钥。
      throw new RpcError('conflict', PC.verifyFailed({ message: failure.message }), { code, providerId: config.providerId });
    }
    throw new RpcError('conflict', PC.verifyFailed({ message: PH.requestIncomplete() }), { code: 'PROVIDER_UNAVAILABLE', providerId: config.providerId });
  }

  /** 执行者在调用结束时的报告：写一条用量，按结果记下用的账号的状态（只记录，不换账号，§6.2）。 */
  #reporter(providerId: string): CallReporter {
    return (report) => {
      const at = new Date().toISOString();
      this.#record({
        at,
        providerId,
        accountId: report.accountId,
        capability: report.capability,
        modelId: report.modelId,
        source: report.source,
        ...(report.ref ? { ref: report.ref } : {}),
        units: report.units,
        cost: report.cost ?? { kind: 'unknown' },
        durationMs: Math.max(0, Date.now() - report.startedAt),
        status: report.error === undefined ? 'ok' : 'error',
        ...(report.error !== undefined ? { error: usageErrorOf(report.error) } : {}),
      });
      if (report.accountId) this.#store.recordAccountResult(providerId, report.accountId, at, accountStatusOf(report.error, at));
    };
  }

  #record(record: UsageRecord): void {
    void this.#options.usage?.append(record);
  }

  /** 账号方法的 Provider：目录里的服务商或已有的自定义端点。 */
  #accountProvider(providerId: string): string {
    if (isBuiltin(providerId)) return providerId;
    if (providerId.startsWith(CUSTOM_PREFIX)) {
      if (this.#store.provider(providerId)) return providerId;
      throw new RpcError('not-found', PC.providerNotFound({ id: providerId }));
    }
    throw new RpcError('invalid-request', PC.noAccounts({ id: providerId }));
  }

  /** `region` 要是目录里这家服务商的地区之一；没有地区的服务商不接受 `region`。 */
  #checkRegion(providerId: string, region: string | undefined): void {
    if (region === undefined) return;
    const regions = isBuiltin(providerId) ? BUILTINS[providerId].regions : undefined;
    if (!regions || !Object.hasOwn(regions, region)) {
      throw new RpcError('invalid-request', PC.noRegion({ label: this.#label(providerId), region }), {
        regions: regions ? Object.keys(regions) : [],
      });
    }
  }

  /**
   * 基址（§6.4）：账号的改写优先，其次是服务商的端点，最后是目录的预设——有地区的按账号的 `region`（测试的 `baseUrls`
   * 改写预设）。
   */
  #baseUrl(providerId: string, endpoint: string | undefined, account?: Pick<StoredAccount, 'region' | 'endpoint'>): string {
    let preset = '';
    if (isBuiltin(providerId)) {
      const entry = BUILTINS[providerId];
      const regional = account?.region ? entry.regions?.[account.region] : undefined;
      preset = this.#options.baseUrls?.[providerId] ?? regional ?? entry.baseUrl;
    }
    const base = account?.endpoint ?? endpoint ?? preset;
    return base.replace(/\/+$/, '');
  }

  #label(providerId: string): string {
    if (isBuiltin(providerId)) return BUILTINS[providerId].label;
    return this.#store.provider(providerId)?.label ?? providerId.slice(CUSTOM_PREFIX.length);
  }

  #adapterSet(providerId: string): AdapterSet {
    let adapters = this.#adapters.get(providerId);
    if (!adapters) {
      if (isBuiltin(providerId)) {
        adapters = BUILTINS[providerId].adapters();
      } else {
        const label = () => this.#label(providerId);
        const transcribe = new CompatibleAdapter(label);
        const text = new CompatibleTextAdapter(label);
        adapters = {
          transcribe,
          speech: new CompatibleSpeechAdapter(label),
          image: new CompatibleImageAdapter(label),
          text,
          validator: transcribe,
          lister: text,
        };
      }
      this.#adapters.set(providerId, adapters);
    }
    return adapters;
  }
}

/**
 * 用取到的列表标注模型（就地修改）：不在列表里的报告为不可用；账号里的音色补进没有预置音色、接受自定义音色的语音模型。
 * 列表里多出来的模型不加进来：没有它们的限制与特性。
 */
function annotate(models: ModelInfoBase[], discovered: DiscoveredList): void {
  const listed = new Set(discovered.models ?? []);
  for (const model of models) {
    if (discovered.models && !listed.has(model.modelId) && model.available !== false) {
      Object.assign(model, {
        available: false,
        unavailableReason: 'unsupported',
        ...modelDetail(PC.notInVendorList({ at: discovered.at })),
      });
    }
    const speech = model as Partial<SpeechModelInfo>;
    if (discovered.voices && speech.voices?.length === 0 && speech.voiceModes?.includes('custom')) {
      speech.voices = discovered.voices.map((v) => ({ ...v }));
    }
  }
}

function isBuiltin(providerId: string): providerId is BuiltinId {
  return Object.hasOwn(BUILTINS, providerId);
}
