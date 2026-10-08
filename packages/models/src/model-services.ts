import {
  DEFAULT_TEXT_CONCURRENCY,
  MODEL_SERVICE_CAPABILITIES,
  RpcError,
  type AddProviderAccountRequest,
  type ArrangeProviderAccountsRequest,
  type CapabilityView,
  type ConfigureProviderRequest,
  type ModelCapabilitiesView,
  type ModelRef,
  type ModelServiceCapability,
  type ProviderCapabilityView,
  type ProviderRefreshStatus,
  type ProviderView,
  type SetCapabilityParametersRequest,
  type TextCapabilityParameters,
  type UpdateProviderAccountRequest,
  type UsageReport,
  type UsageRequest,
} from '@baocut/protocol';
import { ModelsModelServices as M } from '@baocut/protocol/messages/models/model-services.ts';
import type { GenerationCapability, GenerationProvider } from './generation-provider.ts';
import type { ModelServiceStore } from './model-service-store.ts';
import { capabilityNotConfiguredError, effectiveChoice, hasFactoryDefault, selectModel, type ModelChoice } from './model-selection.ts';
import type { DescribeMode, ProviderQueue, ProviderSource } from './provider-source.ts';
import {
  createTextGenerator,
  TextJobGenerator,
  TextRunner,
  type TextCallStats,
  type TextGenerator,
  type TextSelection,
} from './text-generation.ts';
import type { TranscribeProvider } from './transcribe-provider.ts';
import type { UsageLedger } from './usage-ledger.ts';
import { buildUsageReport } from './usage-report.ts';

/**
 * 模型服务（架构设计 §6.1、§6.2、§6.8）：Provider 注册表、配置与选择的入口。
 *
 * - `capabilities()` 是 `models.capabilities` 的视图（会探测节点）；`view()` 是最近一次算出的视图，`models` 主题的快照用它；
 * - 配置、默认值变化后重算视图（不联网），与上一次不同时通知 `onChange`；
 * - `selectTranscribe()` / `selectGeneration()` 在提交时确定 Provider 与模型（`select` 取法，不联网），交出执行者与队列；
 * - `generateText` 的任务与进程内调用（`textGenerator()`）共用一个 `TextRunner`：每个 Provider 的并发上限取能力参数
 *   `concurrency`，任务的队列也按它排（队列键 `<providerId>:generateText`，不与同一个 Provider 的语音、图片任务抢名额）。
 */

export interface ModelServicesOptions {
  store: ModelServiceStore;
  sources: ProviderSource[];
  /** 用量账本（§6.10）：`models.usage` 读它；不给时报告为空。 */
  usage?: UsageLedger;
}

/** `models.transcribe` 的目标写法：新的 `provider` / `model` 与旧的 `node` / `bundleId`。 */
export interface TranscribeTarget {
  provider?: string;
  model?: string;
  node?: string;
  bundleId?: string;
}

export interface TranscribeSelection extends ModelChoice<'transcribe'> {
  /** 本地与节点的模型包；在线为 null。 */
  bundleId: string | null;
  transcriber: TranscribeProvider;
  queue: ProviderQueue;
}

/** `models.synthesizeSpeech` / `models.generateImage` 的目标写法。 */
export interface GenerationTarget {
  provider?: string;
  model?: string;
}

export interface GenerationSelection<C extends GenerationCapability = GenerationCapability> extends ModelChoice<C> {
  generator: GenerationProvider;
  queue: ProviderQueue;
  /** `generateText`：提交时用的参数默认值（推理强度）。 */
  textDefaults?: TextCapabilityParameters;
}

export class ModelServices {
  readonly store: ModelServiceStore;
  readonly #sources: ProviderSource[];
  readonly #usage: UsageLedger | null;
  readonly #listeners = new Set<(view: ModelCapabilitiesView) => void>();
  #view: ModelCapabilitiesView;
  #viewKey = '';
  readonly #textRunner: TextRunner;
  readonly #textJobs = new Map<string, TextJobGenerator>();
  #textGenerator: TextGenerator | null = null;

  constructor(options: ModelServicesOptions) {
    this.store = options.store;
    this.#sources = options.sources;
    this.#usage = options.usage ?? null;
    // 账号状态（最近一次调用的结果）变化时重算视图，经 `capabilities.updated` 送达（§6.8）。
    this.store.onAccountChange(() => void this.refresh().catch(() => {}));
    this.#view = emptyView();
    this.#viewKey = JSON.stringify(this.#view);
    this.#textRunner = new TextRunner({ concurrency: () => this.store.textParameters().concurrency });
  }

  /** `models.capabilities`：探测节点（每个至多 2 秒，并行），更新缓存的视图。 */
  async capabilities(): Promise<ModelCapabilitiesView> {
    return this.#recompute('probe');
  }

  /** 最近一次算出的视图（同步）。 */
  view(): ModelCapabilitiesView {
    return structuredClone(this.#view);
  }

  /** 配置、模型包或节点变化之后重算视图（不联网）。 */
  refresh(): Promise<ModelCapabilitiesView> {
    return this.#recompute('view');
  }

  onChange(listener: (view: ModelCapabilitiesView) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 一个 Provider 的完整视图；不存在时 `not-found`。 */
  async provider(providerId: string): Promise<ProviderView> {
    const { source, id } = this.#resolve(providerId);
    const view = await source.describe(id, 'view');
    if (!view) throw new RpcError('not-found', M.noSuchProvider({ provider: providerId }));
    return view;
  }

  async configure(request: ConfigureProviderRequest): Promise<ProviderView> {
    const source = this.#owner(request.providerId);
    if (!source) throw new RpcError('not-found', M.noSuchProvider({ provider: request.providerId }));
    if (!source.configure) throw new RpcError('invalid-request', M.noConfigureNeeded());
    await source.configure(request);
    await this.refresh();
    return this.provider(request.providerId);
  }

  async removeProvider(providerId: string): Promise<void> {
    const source = this.#owner(providerId);
    if (!source) throw new RpcError('not-found', M.noSuchProvider({ provider: providerId }));
    if (!source.remove) throw new RpcError('invalid-request', M.cannotRemove());
    if (!(await source.remove(providerId))) throw new RpcError('not-found', M.noSuchProvider({ provider: providerId }));
    await this.refresh();
  }

  /** `models.addAccount`（§6.8）：返回这个 Provider 的视图。本机、节点与智能体 Provider 没有账号，`invalid-request`。 */
  async addAccount(request: AddProviderAccountRequest): Promise<ProviderView> {
    await this.#accountSource(request.providerId).addAccount!(request);
    await this.refresh();
    return this.provider(request.providerId);
  }

  async updateAccount(request: UpdateProviderAccountRequest): Promise<ProviderView> {
    await this.#accountSource(request.providerId).updateAccount!(request);
    await this.refresh();
    return this.provider(request.providerId);
  }

  async removeAccount(providerId: string, accountId: string): Promise<ProviderView> {
    await this.#accountSource(providerId).removeAccount!(providerId, accountId);
    await this.refresh();
    return this.provider(providerId);
  }

  async arrangeAccounts(request: ArrangeProviderAccountsRequest): Promise<ProviderView> {
    await this.#accountSource(request.providerId).arrangeAccounts!(request);
    await this.refresh();
    return this.provider(request.providerId);
  }

  /**
   * `models.usage`（§6.10）：读账本，按时段与服务商汇总，读的时候按价目表估价。账本读不了时抛出（不当作空）；
   * 账号的显示名取现在的配置（名字，没有时掩码），已经删掉的账号按 `accountId` 列出。
   */
  async usage(request: UsageRequest, now: Date = new Date()): Promise<UsageReport> {
    const records = this.#usage ? await this.#usage.read() : [];
    const labels = new Map<string, string>();
    for (const provider of await this.#list('view')) labels.set(provider.providerId, provider.label);
    return buildUsageReport(records, {
      period: request.period,
      ...(request.providerId ? { providerId: request.providerId } : {}),
      now,
      providerLabel: (id) => labels.get(id) ?? id,
      accountLabel: (providerId, accountId) => {
        const account = this.store.provider(providerId)?.accounts.find((a) => a.accountId === accountId);
        return account ? (account.label ?? account.masked) : null;
      },
    });
  }

  #accountSource(providerId: string): ProviderSource {
    const source = this.#owner(providerId);
    if (!source) throw new RpcError('not-found', M.noSuchProvider({ provider: providerId }));
    if (!source.addAccount || !source.updateAccount || !source.removeAccount || !source.arrangeAccounts) {
      throw new RpcError('invalid-request', M.noAccounts());
    }
    return source;
  }

  /** 改能力参数的默认值（首版只有 `generateText`），返回补全后的值。并发上限对之后排队的调用立即生效。 */
  async setCapabilityParameters(request: SetCapabilityParametersRequest): Promise<TextCapabilityParameters> {
    if (request.capability !== 'generateText') throw new RpcError('invalid-request', M.noCapabilityParameters({ capability: request.capability }));
    const parameters = await this.store.setTextParameters({
      ...(request.effort !== undefined ? { effort: request.effort } : {}),
      ...(request.concurrency !== undefined ? { concurrency: request.concurrency } : {}),
    });
    await this.refresh();
    return parameters;
  }

  /** 向一个在线 Provider 取模型（与音色）列表（§6.8）。取不到时照旧用内置列表，`ok: false`。 */
  async refreshProvider(providerId: string): Promise<{ provider: ProviderView; refreshed: ProviderRefreshStatus }> {
    const { source, id } = this.#resolve(providerId);
    if (!source.refresh) throw new RpcError('invalid-request', M.noRefresh());
    const refreshed = await source.refresh(id);
    await this.refresh();
    return { provider: await this.provider(id), refreshed };
  }

  /** 进程内的文本生成入口（§6.1）：与 `models.generateText` 的任务共用选择、并发上限、计数与结果检查。 */
  textGenerator(): TextGenerator {
    this.#textGenerator ??= createTextGenerator({ select: (target) => this.selectText(target), runner: this.#textRunner });
    return this.#textGenerator;
  }

  /** `generateText` 各 Provider 的调用、重试与失败计数。 */
  textStats(): Record<string, TextCallStats> {
    return this.#textRunner.stats();
  }

  /** 设置或清除一种能力的默认值。Provider 要存在并声明这种能力；不给模型时用它的默认模型。不要求此刻可用。 */
  async setDefault(capability: ModelServiceCapability, providerId: string | null, modelId?: string): Promise<ModelRef | null> {
    if (providerId === null) {
      if (modelId !== undefined) throw new RpcError('invalid-request', M.clearWithModel());
      await this.store.setDefault(capability, null);
      await this.refresh();
      return null;
    }
    const { source, id } = this.#resolve(providerId);
    const view = await source.describe(id, 'select');
    if (!view) throw new RpcError('not-found', M.noSuchProvider({ provider: providerId }));
    const cap = view.capabilities[capability];
    if (!cap) throw new RpcError('invalid-request', M.capabilityNotOffered({ provider: view.label, capability }));
    let model = modelId;
    if (model === undefined) {
      model = (cap.models.find((m) => m.default) ?? cap.models[0])?.modelId;
      if (model === undefined) throw new RpcError('invalid-request', M.noSelectableModel({ provider: view.label }));
    } else if (view.kind !== 'node' && !cap.models.some((m) => m.modelId === model)) {
      throw new RpcError('not-found', M.providerNoModel({ provider: view.label, model }));
    }
    const ref = { providerId: id, modelId: model };
    await this.store.setDefault(capability, ref);
    await this.refresh();
    return ref;
  }

  /**
   * 删除本地模型包之后（`models.remove`，§6.8）：没有出厂默认的能力里指向它的默认值清掉，回到「未设置」；`transcribe` 有出厂
   * 默认，指向它的默认值保留并报告为不可用。返回清掉了哪些能力。
   */
  async clearLocalDefaults(bundleId: string): Promise<ModelServiceCapability[]> {
    const cleared = MODEL_SERVICE_CAPABILITIES.filter((capability) => {
      if (hasFactoryDefault(capability)) return false;
      const ref = this.store.getDefault(capability);
      return ref?.providerId === 'local' && ref.modelId === bundleId;
    });
    if (cleared.length === 0) return cleared;
    for (const capability of cleared) await this.store.setDefault(capability, null);
    await this.refresh();
    return cleared;
  }

  /** 提交时选择 `transcribe` 的 Provider 与模型（§6.2）。不可用时抛 `CAPABILITY_NOT_CONFIGURED`。 */
  async selectTranscribe(target: TranscribeTarget): Promise<TranscribeSelection> {
    let provider: string | undefined;
    if (target.provider !== undefined) provider = this.#resolve(target.provider).id;
    if (target.node !== undefined) {
      const fromNode = this.#resolve(`node:${target.node}`).id;
      if (provider !== undefined && provider !== fromNode) throw new RpcError('invalid-request', M.providerNodeConflict());
      provider = fromNode;
    }
    if (target.model !== undefined && target.bundleId !== undefined && target.model !== target.bundleId) {
      throw new RpcError('invalid-request', M.modelBundleMismatch());
    }
    const model = target.model ?? target.bundleId;
    const providers = await this.#list('select');
    const choice = selectModel({
      capability: 'transcribe',
      ...(provider !== undefined ? { provider } : {}),
      ...(model !== undefined ? { model } : {}),
      userDefault: this.store.getDefault('transcribe'),
      providers,
    });
    const source = this.#owner(choice.providerId)!;
    const transcriber = source.transcriber(choice.providerId);
    if (!transcriber) {
      throw capabilityNotConfiguredError(
        'transcribe',
        'unsupported',
        choice.providerId,
        'set-default',
        M.cannotTranscribe({ provider: choice.label }),
      );
    }
    return {
      ...choice,
      bundleId: choice.kind === 'online' ? null : choice.modelId,
      transcriber,
      queue: source.queue(choice.providerId, choice.modelId),
    };
  }

  /**
   * 提交时选择生成能力的 Provider 与模型（§6.2）。这两种能力没有出厂默认：不显式指定、也没有用户默认值时
   * 抛 `CAPABILITY_NOT_CONFIGURED`（`reason: 'no-default'`）。
   */
  async selectGeneration<C extends GenerationCapability>(capability: C, target: GenerationTarget): Promise<GenerationSelection<C>> {
    const provider = target.provider !== undefined ? this.#resolve(target.provider).id : undefined;
    const providers = await this.#list('select');
    const choice = selectModel({
      capability,
      ...(provider !== undefined ? { provider } : {}),
      ...(target.model !== undefined ? { model: target.model } : {}),
      userDefault: this.store.getDefault(capability),
      providers,
    });
    const source = this.#owner(choice.providerId)!;
    if (capability === 'generateText') {
      const text = this.#textSelection(choice as ModelChoice<'generateText'>, source);
      let generator = this.#textJobs.get(choice.providerId);
      if (!generator) {
        generator = new TextJobGenerator(this.#textRunner, text.text);
        this.#textJobs.set(choice.providerId, generator);
      }
      return {
        ...choice,
        generator,
        queue: { key: `${choice.providerId}:generateText`, concurrency: text.defaults.concurrency },
        textDefaults: text.defaults,
      };
    }
    const generator = source.generator?.(choice.providerId, capability) ?? null;
    if (!generator) {
      throw capabilityNotConfiguredError(
        capability,
        'unsupported',
        choice.providerId,
        'set-default',
        M.cannotUseCapability({ provider: choice.label }),
      );
    }
    return { ...choice, generator, queue: source.queue(choice.providerId, choice.modelId) };
  }

  /**
   * 选择 `separateAudio` 的 Provider 与模型（§6.2，有出厂默认）：只有本机的分离模型包，由调用方（翻译配音）直接交给
   * Model Worker，这里只定模型。不可用时抛 `CAPABILITY_NOT_CONFIGURED`。
   */
  async selectSeparate(target: GenerationTarget): Promise<ModelChoice<'separateAudio'>> {
    const provider = target.provider !== undefined ? this.#resolve(target.provider).id : undefined;
    return selectModel({
      capability: 'separateAudio',
      ...(provider !== undefined ? { provider } : {}),
      ...(target.model !== undefined ? { model: target.model } : {}),
      userDefault: this.store.getDefault('separateAudio'),
      providers: await this.#list('select'),
    });
  }

  /** 选择 `generateText` 的 Provider 与模型（§6.2，没有出厂默认），交出文本执行者与参数默认值。 */
  async selectText(target: GenerationTarget): Promise<TextSelection> {
    const provider = target.provider !== undefined ? this.#resolve(target.provider).id : undefined;
    const providers = await this.#list('select');
    const choice = selectModel({
      capability: 'generateText',
      ...(provider !== undefined ? { provider } : {}),
      ...(target.model !== undefined ? { model: target.model } : {}),
      userDefault: this.store.getDefault('generateText'),
      providers,
    });
    return this.#textSelection(choice, this.#owner(choice.providerId)!);
  }

  #textSelection(choice: ModelChoice<'generateText'>, source: ProviderSource): TextSelection {
    const text = source.textProvider?.(choice.providerId) ?? null;
    if (!text) {
      throw capabilityNotConfiguredError(
        'generateText',
        'unsupported',
        choice.providerId,
        'set-default',
        M.cannotGenerateText({ provider: choice.label }),
      );
    }
    return { ...choice, text, defaults: this.store.textParameters() };
  }

  /** 一个 `providerId` 的执行者（本地文件任务等不经选择的路径用）。 */
  transcriber(providerId: string): TranscribeProvider | null {
    return this.#owner(providerId)?.transcriber(providerId) ?? null;
  }

  /** 所有转写执行者（去重）。 */
  executors(): TranscribeProvider[] {
    return [...new Set(this.#sources.flatMap((s) => s.executors()))];
  }

  /** 所有生成执行者（去重）。 */
  generators(): GenerationProvider[] {
    return [...new Set([...this.#sources.flatMap((s) => s.generators?.() ?? []), ...this.#textJobs.values()])];
  }

  // ---- 内部 ----

  #owner(providerId: string): ProviderSource | undefined {
    return this.#sources.find((s) => s.owns(providerId));
  }

  /** 规范化：别名 → `node:<nodeId>`。不认识时 `not-found`。 */
  #resolve(providerId: string): { source: ProviderSource; id: string } {
    const source = this.#owner(providerId);
    const id = source?.resolve(providerId) ?? null;
    if (!source || !id) throw new RpcError('not-found', M.noSuchProvider({ provider: providerId }));
    return { source, id };
  }

  async #list(mode: DescribeMode): Promise<ProviderView[]> {
    return (await Promise.all(this.#sources.map((s) => s.list(mode)))).flat();
  }

  async #recompute(mode: DescribeMode): Promise<ModelCapabilitiesView> {
    const providers = await this.#list(mode);
    const view = {} as Record<ModelServiceCapability, CapabilityView>;
    for (const capability of MODEL_SERVICE_CAPABILITIES) {
      const userDefault = this.store.getDefault(capability);
      const entries: CapabilityView['providers'] = [];
      for (const p of providers) {
        const cap = p.capabilities[capability];
        if (!cap) continue;
        entries.push({ providerId: p.providerId, kind: p.kind, label: p.label, config: p.config, ...structuredClone(cap) });
      }
      // 生图的本地 Provider 排在在线与智能体之后（设计稿的模型菜单：云端、Codex、本机）。
      if (capability === 'generateImage') entries.sort((a, b) => Number(a.kind === 'local') - Number(b.kind === 'local'));
      view[capability] = { default: userDefault, effective: effectiveChoice({ capability, userDefault, providers }), providers: entries };
      if (capability === 'generateText') view[capability].parameters = this.store.textParameters();
    }
    const result = view as ModelCapabilitiesView;
    const key = JSON.stringify(result);
    this.#view = result;
    if (key !== this.#viewKey) {
      this.#viewKey = key;
      for (const listener of this.#listeners) listener(structuredClone(result));
    }
    return structuredClone(result);
  }
}

function emptyView(): ModelCapabilitiesView {
  const view = {} as Record<ModelServiceCapability, CapabilityView>;
  for (const capability of MODEL_SERVICE_CAPABILITIES) view[capability] = { default: null, effective: null, providers: [] };
  view.generateText.parameters = { effort: null, concurrency: DEFAULT_TEXT_CONCURRENCY };
  return view as ModelCapabilitiesView;
}
