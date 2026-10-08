import type { AgentDriver } from '@baocut/harness';
import type {
  DescribeMode,
  GenerationCapability,
  GenerationProvider,
  ModelServiceStore,
  ProviderQueue,
  ProviderSource,
  TranscribeProvider,
  UsageLedger,
} from '@baocut/models';
import {
  AGENT_PROVIDER_PREFIX,
  refOf,
  RpcError,
  type ConfigureProviderRequest,
  type DriverId,
  type DriverProbe,
  type ImageModelInfo,
  type Localized,
  type MessageRef,
  type ProviderCapability,
  type ProviderConfigView,
  type ProviderUnavailableReason,
  type ProviderView,
} from '@baocut/protocol';
import { usageErrorOf } from '../usage-reporter.ts';
import { AgentImageGenerator, type AgentReadiness } from './agent-image-generator.ts';
import { ProvidersAgent as PA, ProvidersConfig as PC } from '@baocut/protocol/messages/providers';

/** 智能体 Provider 的配置视图：只有开关与启用时间，不用密钥（`credential: 'none'`），没有账号（§6.8）。 */
function agentConfigView(view: ProviderConfigView): ProviderConfigView {
  const { accounts: _accounts, ...rest } = view;
  return { ...rest, credential: 'none' };
}

/** 智能体 Provider 要用的 Driver 注册表的一部分（`DriverRegistry`）。 */
export interface AgentDrivers {
  /**
   * 一个 Driver 的状态：注册表里 `maxAgeMs` 之内的结果直接用，否则只重新探测这一个 Driver 并等它（结果写回注册表的缓存）。
   * 不等别的 Driver 的探测。没注册为 null。
   */
  current(id: DriverId, maxAgeMs: number): Promise<DriverProbe | null>;
  /** 没有注册时抛错。 */
  get(id: DriverId): AgentDriver;
  /** 用户手动指定的可执行文件；没指定为 null（Driver 自己找）。 */
  executable(id: DriverId): string | null;
}

export interface AgentSourceOptions {
  store: ModelServiceStore;
  drivers: AgentDrivers;
  /** 复用最近一次 Driver 探测的期限（毫秒，默认 10 秒）。 */
  probeMaxAgeMs?: number;
  /** 一次生成的期限（毫秒，默认 10 分钟）。 */
  turnTimeoutMs?: number;
  /** 用量账本（§6.10）：智能体 Provider 的调用同样记录，`accountId` 为 null，费用未知。 */
  usage?: UsageLedger;
}

/** 一个智能体 Provider 的定义。首版只有 `agent:codex` 的 `generateImage`。 */
interface AgentProviderDefinition {
  driverId: DriverId;
  label: string;
  /** 低于它的版本不可用（`outdated`）：协议按这个版本对照（`codex-protocol.ts`）。 */
  minVersion: string;
  upgradeHint: Localized;
  model: ImageModelInfo;
  instructions: string;
  turnText: (prompt: string) => string;
  outputName: string;
}

const CODEX_OUTPUT = 'output.png';

const CODEX: AgentProviderDefinition = {
  driverId: 'codex',
  label: 'Codex',
  minVersion: '0.158.0',
  get upgradeHint() {
    return PA.codexUpgradeHint();
  },
  model: {
    modelId: 'image-gen',
    get label() {
      return PA.codexImageModel().text;
    },
    default: true,
    sizes: [],
    aspectRatios: [],
    defaultSize: null,
    maxCount: 1,
    maxPromptChars: 4000,
    formats: ['png'],
    defaultFormat: 'png',
    referenceImages: null,
    acceptsSeed: false,
    cost: 'subscription',
    get notes() {
      return PA.codexImageNotes().text;
    },
  },
  instructions: [
    'You are running as a non-interactive image generation backend. Nobody reads your reply and nobody can approve anything.',
    'Task: generate exactly one image for the prompt in the user message, using your built-in image generation tool.',
    'Do not draw the image with code, do not download images from the internet, and do not ask questions.',
    `Save the generated image as a PNG file named ${CODEX_OUTPUT} in the current working directory. If the tool saved it elsewhere, copy it to ./${CODEX_OUTPUT}.`,
    'Do not create, modify or delete any other file, and do not touch anything outside the current working directory.',
    `If you cannot generate the image, do not write ${CODEX_OUTPUT}; reply with one sentence saying why.`,
  ].join('\n'),
  turnText: (prompt) => `Image prompt (use it as given):\n${prompt}`,
  outputName: CODEX_OUTPUT,
};

const DEFINITIONS: Record<string, AgentProviderDefinition> = { [`${AGENT_PROVIDER_PREFIX}codex`]: CODEX };

const DEFAULT_PROBE_MAX_AGE_MS = 10_000;
const DEFAULT_TURN_TIMEOUT_MS = 10 * 60_000;

type Availability =
  | { available: true }
  | { available: false; reason: ProviderUnavailableReason; detail: string; detailRef?: MessageRef };

/** 不可用：Runtime 的文案带上引用（界面按当前语言重新生成）。 */
function unavailable(reason: ProviderUnavailableReason, detail: Localized): Availability {
  return { available: false, reason, detail: detail.text, detailRef: refOf(detail) };
}

/**
 * 智能体 Provider 来源（架构设计 §6.9）：本机已安装并登录的智能体运行时，经它的 Driver 作为一个图片 Provider。
 * 首版只有 `agent:codex`（`generateImage`），只在注册了 Codex Driver 时列出。
 *
 * - 可用性按顺序：Driver 没有安装（`not-installed`）、没有登录（`signed-out`）、别的不可用（`unsupported`）、版本低于
 *   最低版本（`outdated`）、用户没有启用（`not-configured`）。前三样的说明来自 Driver 的探测。
 * - 配置只有开关：没有密钥、端点与模型声明（用的是智能体运行时自己的登录）。启用即同意把提示词与参考图发给它的账号。
 * - 探测：`probe` 总是问 Driver（Driver 注册表短时缓存）；`select` 与 `view` 在用户启用了它时问 Driver，没启用时用
 *   最近一次的结果，一次也没探测过就只报告没有启用——不为没启用的 Provider 去启动外部命令。
 * - 每个 Provider 一个队列，同时只运行 1 个任务。
 */
export class AgentProviderSource implements ProviderSource {
  readonly kind = 'agent' as const;
  readonly #options: AgentSourceOptions;
  readonly #generators = new Map<string, AgentImageGenerator>();
  /** 最近一次探测到的 Driver 状态。 */
  readonly #lastInfo = new Map<DriverId, DriverProbe>();

  constructor(options: AgentSourceOptions) {
    this.#options = options;
  }

  owns(providerId: string): boolean {
    return providerId.startsWith(AGENT_PROVIDER_PREFIX);
  }

  resolve(providerId: string): string | null {
    const definition = DEFINITIONS[providerId];
    return definition && this.#driver(definition) ? providerId : null;
  }

  async list(mode: DescribeMode): Promise<ProviderView[]> {
    const views: ProviderView[] = [];
    for (const id of Object.keys(DEFINITIONS)) {
      const view = await this.describe(id, mode);
      if (view) views.push(view);
    }
    return views;
  }

  async describe(providerId: string, mode: DescribeMode): Promise<ProviderView | null> {
    const definition = DEFINITIONS[providerId];
    if (!definition || !this.#driver(definition)) return null;
    const availability = await this.#availability(providerId, definition, mode);
    const capability: ProviderCapability<ImageModelInfo> = {
      models: [{ ...definition.model }],
      available: availability.available,
      ...(availability.available
        ? {}
        : {
            unavailableReason: availability.reason,
            detail: availability.detail,
            ...(availability.detailRef ? { detailRef: availability.detailRef } : {}),
          }),
    };
    return {
      providerId,
      kind: 'agent',
      label: definition.label,
      vendor: { kind: 'agent', icon: 'codex' },
      config: agentConfigView(this.#options.store.configView(providerId)),
      capabilities: { generateImage: capability },
    };
  }

  transcriber(_providerId: string): TranscribeProvider | null {
    return null;
  }

  generator(providerId: string, capability: GenerationCapability): GenerationProvider | null {
    const definition = DEFINITIONS[providerId];
    if (!definition || capability !== 'generateImage' || !this.#driver(definition)) return null;
    let generator = this.#generators.get(providerId);
    if (!generator) {
      generator = new AgentImageGenerator({
        providerId,
        label: definition.label,
        // 执行时再确认一次：排队期间被停用、退出登录或卸载的，不再开会话。
        ready: () => this.#readiness(providerId, definition),
        instructions: definition.instructions,
        turnText: definition.turnText,
        outputName: definition.outputName,
        turnTimeoutMs: this.#options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS,
        report: (report) => {
          void this.#options.usage?.append({
            at: new Date().toISOString(),
            providerId,
            accountId: null,
            capability: report.capability,
            modelId: report.modelId,
            source: report.source,
            ...(report.ref ? { ref: report.ref } : {}),
            units: report.units,
            cost: { kind: 'unknown' },
            durationMs: Math.max(0, Date.now() - report.startedAt),
            status: report.error === undefined ? 'ok' : 'error',
            ...(report.error !== undefined ? { error: usageErrorOf(report.error) } : {}),
          });
        },
      });
      this.#generators.set(providerId, generator);
    }
    return generator;
  }

  generators(): GenerationProvider[] {
    return [...this.#generators.values()];
  }

  /** 智能体一次只做一件事：每个 Provider 一个队列，同时只运行 1 个任务。 */
  queue(providerId: string, _modelId: string): ProviderQueue {
    return { key: providerId, concurrency: 1 };
  }

  executors(): TranscribeProvider[] {
    return [];
  }

  /** 只接受开关。启用即同意把提示词（与参考图）发给这个智能体运行时登录的账号。 */
  async configure(request: ConfigureProviderRequest): Promise<void> {
    const id = request.providerId;
    const definition = DEFINITIONS[id];
    if (!definition || !this.#driver(definition)) throw new RpcError('not-found', PC.providerNotFound({ id }));
    const extra = (['credential', 'endpoint', 'models', 'label', 'verify'] as const).filter((key) => request[key] !== undefined);
    if (extra.length > 0) {
      throw new RpcError('invalid-request', PC.toggleOnly({ label: definition.label, fields: extra.join(PC.listSeparator().text) }));
    }
    if (request.enabled === undefined) throw new RpcError('invalid-request', PC.giveEnabled({ label: definition.label }));
    await this.#options.store.updateProvider(id, { enabled: request.enabled });
  }

  // ---- 内部 ----

  #driver(definition: AgentProviderDefinition): AgentDriver | null {
    try {
      return this.#options.drivers.get(definition.driverId);
    } catch {
      return null;
    }
  }

  async #info(definition: AgentProviderDefinition): Promise<DriverProbe | null> {
    const info = await this.#options.drivers
      .current(definition.driverId, this.#options.probeMaxAgeMs ?? DEFAULT_PROBE_MAX_AGE_MS)
      .catch(() => null);
    if (info) this.#lastInfo.set(definition.driverId, info);
    return info;
  }

  async #availability(providerId: string, definition: AgentProviderDefinition, mode: DescribeMode): Promise<Availability> {
    const enabled = this.#options.store.provider(providerId)?.enabled ?? false;
    const info = mode === 'probe' || enabled ? await this.#info(definition) : (this.#lastInfo.get(definition.driverId) ?? null);
    if (!info && !enabled) return unavailable('not-configured', PC.notEnabled());
    return evaluate(definition, info, enabled);
  }

  async #readiness(providerId: string, definition: AgentProviderDefinition): Promise<AgentReadiness> {
    const enabled = this.#options.store.provider(providerId)?.enabled ?? false;
    const driver = this.#driver(definition);
    const info = await this.#info(definition);
    const availability = evaluate(definition, info, enabled);
    if (!availability.available) return { ok: false, reason: availability.reason, message: availability.detail };
    if (!driver) return { ok: false, reason: 'not-installed', message: PC.driverNotRegistered().text };
    return { ok: true, driver, version: info!.version!, executable: this.#options.drivers.executable(definition.driverId) };
  }
}

/** Driver 状态 + 版本 + 开关 → 可用性（顺序见类注释）。 */
function evaluate(definition: AgentProviderDefinition, info: DriverProbe | null, enabled: boolean): Availability {
  const name = definition.label;
  if (!info) return unavailable('unsupported', PC.noStatus({ name }));
  // Driver 自己报的「版本太旧」与这个 Provider 的最低版本走同一条路：补救都是升级（架构设计 §6.9）。
  const outdated = info.state === 'outdated' || (info.status === 'available' && (!info.version || compareVersions(info.version, definition.minVersion) < 0));
  if (info.status !== 'available' && !outdated) {
    // Driver 探测的说明带着它自己的引用（探测结果会缓存）；没有说明时用这里的文案。
    const fallback = PC.agentUnavailable({ name });
    const detail = info.detail
      ? { detail: info.detail, ...(info.detailRef ? { detailRef: info.detailRef } : {}) }
      : { detail: fallback.text, detailRef: refOf(fallback) };
    const reason: ProviderUnavailableReason = info.state === 'not-installed' || info.state === 'signed-out' ? info.state : 'unsupported';
    return { available: false, reason, ...detail };
  }
  if (outdated) {
    return unavailable(
      'outdated',
      PC.versionTooOld({
        name,
        version: info.version ?? PC.unknownVersion(),
        min: definition.minVersion,
        hint: definition.upgradeHint,
      }),
    );
  }
  if (!enabled) return unavailable('not-configured', PC.notEnabled());
  return { available: true };
}

/** 按数字逐段比较 `0.160.0`、`0.160.0-alpha.2` 这样的版本号（预发布后缀当作更多的段）。 */
function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
