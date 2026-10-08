import type {
  ImageModelInfo,
  MessageRef,
  ModelBundleStatus,
  ProviderCapability,
  ProviderUnavailableReason,
  ProviderView,
  SeparateModelInfo,
  SpeechModelInfo,
  TranscribeModelInfo,
} from '@baocut/protocol';
import { ModelsLocalSource as M } from '@baocut/protocol/messages/models/local-source.ts';
import { transcribeLanguages } from './asr-languages.ts';
import type { BundleDefinition } from './bundle-registry.ts';
import type { GenerationCapability, GenerationProvider } from './generation-provider.ts';
import { localImageModelInfo } from './local-image.ts';
import { localSpeechModelInfo } from './local-speech.ts';
import { bundleUsable, type ModelCatalog } from './model-catalog.ts';
import type { DescribeMode, ProviderQueue, ProviderSource } from './provider-source.ts';
import type { TranscribeProvider } from './transcribe-provider.ts';

/**
 * 本地 Provider（`local`）：本机的 Model Worker 与模型目录（架构设计 §6.3、§6.5）。模型是模型包，`modelId` 即 `bundleId`；
 * 每个模型包一个队列，同时只运行一个任务（与节点服务代别人执行的任务共用）。
 *
 * `transcribe` 来自识别的模型包，`synthesizeSpeech` 来自语音合成的模型包（`capability: 'synthesize'`），`generateImage` 来自
 * 文生图的模型包（`capability: 'image'`），`separateAudio` 来自分离的模型包（`capability: 'separate'`，翻译配音用，由 Runtime
 * 直接交给 Model Worker，不经这里的执行者）。合成与生图没有出厂默认（§6.2）：模型的 `default` 只决定显式指定
 * `provider: 'local'` 而不给模型时用哪个；分离与识别有出厂默认，`default` 就是它。模型包按平台筛过（`platformBundles`），
 * 这台机器上不列出的模型包不会成为默认。
 */
export class LocalProviderSource implements ProviderSource {
  readonly kind = 'local' as const;
  readonly #catalog: ModelCatalog;
  readonly #transcriber: TranscribeProvider | null;
  readonly #speech: GenerationProvider | null;
  readonly #image: GenerationProvider | null;

  constructor(options: {
    catalog: ModelCatalog;
    transcriber: TranscribeProvider | null;
    speech?: GenerationProvider | null;
    image?: GenerationProvider | null;
  }) {
    this.#catalog = options.catalog;
    this.#transcriber = options.transcriber;
    this.#speech = options.speech ?? null;
    this.#image = options.image ?? null;
  }

  owns(providerId: string): boolean {
    return providerId === 'local';
  }

  resolve(providerId: string): string | null {
    return providerId === 'local' ? 'local' : null;
  }

  async list(mode: DescribeMode): Promise<ProviderView[]> {
    return [await this.#describe(mode)];
  }

  async describe(providerId: string, mode: DescribeMode): Promise<ProviderView | null> {
    return providerId === 'local' ? this.#describe(mode) : null;
  }

  transcriber(providerId: string): TranscribeProvider | null {
    return providerId === 'local' ? this.#transcriber : null;
  }

  generator(providerId: string, capability: GenerationCapability): GenerationProvider | null {
    if (providerId !== 'local') return null;
    if (capability === 'synthesizeSpeech') return this.#speech;
    if (capability === 'generateImage') return this.#image;
    return null;
  }

  generators(): GenerationProvider[] {
    return [this.#speech, this.#image].filter((g): g is GenerationProvider => g !== null);
  }

  queue(_providerId: string, modelId: string): ProviderQueue {
    return { key: modelId, concurrency: 1 };
  }

  executors(): TranscribeProvider[] {
    return this.#transcriber ? [this.#transcriber] : [];
  }

  async #describe(_mode: DescribeMode): Promise<ProviderView> {
    const all = await this.#catalog.list();
    const statuses = all.filter((s) => s.capability === 'transcribe');
    const models = statuses.map((status) => this.#model(status, all));
    const usable = models.filter((m) => m.available);
    const fallback = this.#catalog.defaultTranscribeBundle();
    const preferred = usable.find((m) => m.modelId === fallback) ?? usable[0] ?? models.find((m) => m.modelId === fallback) ?? models[0];
    if (preferred) preferred.default = true;
    const available = usable.length > 0 && this.#transcriber !== null;
    const reason: ProviderUnavailableReason | undefined = available
      ? undefined
      : this.#transcriber === null
        ? 'unsupported'
        : (preferred?.unavailableReason ?? 'not-installed');
    return {
      providerId: 'local',
      kind: 'local',
      label: M.localLabel().text,
      config: null,
      capabilities: {
        transcribe: {
          models,
          available,
          ...(reason ? { unavailableReason: reason } : {}),
          ...(!available ? detailOf(preferred) : {}),
        },
        ...this.#speechCapability(all),
        ...this.#imageCapability(all),
        ...this.#separateCapability(all),
      },
    };
  }

  /** 语音合成的模型包：登记了才有这项能力；没有一个可用时整项不可用（原因取第一个的）。 */
  #speechCapability(all: ModelBundleStatus[]): { synthesizeSpeech?: ProviderCapability<SpeechModelInfo> } {
    const models = all
      .filter((s) => s.capability === 'synthesize')
      .flatMap((status) => {
        const def = this.#catalog.definition(status.bundleId);
        if (!def?.speech) return [];
        const usable = bundleUsable(status);
        const info = localSpeechModelInfo(def, status, usable);
        return [usable ? info : { ...info, unavailableReason: unavailableReasonOf(status) }];
      });
    if (models.length === 0) return {};
    const usable = models.filter((m) => m.available);
    const preferred = usable[0] ?? models[0]!;
    preferred.default = true;
    const available = usable.length > 0 && this.#speech !== null;
    const reason: ProviderUnavailableReason | undefined = available
      ? undefined
      : this.#speech === null
        ? 'unsupported'
        : (preferred.unavailableReason ?? 'not-installed');
    return {
      synthesizeSpeech: {
        models,
        available,
        ...(reason ? { unavailableReason: reason } : {}),
        ...(!available ? detailOf(preferred) : {}),
      },
    };
  }

  /** 分离的模型包：登记了才有这项能力；默认是按 ID 排第一个可用的（都不可用时第一个，原因取它的）。 */
  #separateCapability(all: ModelBundleStatus[]): { separateAudio?: ProviderCapability<SeparateModelInfo> } {
    const models: SeparateModelInfo[] = all
      .filter((s) => s.capability === 'separate')
      .sort((a, b) => a.bundleId.localeCompare(b.bundleId))
      .map((status) => {
        const usable = bundleUsable(status);
        return {
          modelId: status.bundleId,
          label: status.label ?? status.bundleId,
          cost: 'free-local',
          available: usable,
          ...(usable ? {} : { unavailableReason: unavailableReasonOf(status) }),
          ...(!usable ? detailOf(status) : {}),
        };
      });
    if (models.length === 0) return {};
    const usable = models.filter((m) => m.available);
    const preferred = usable[0] ?? models[0]!;
    preferred.default = true;
    const available = usable.length > 0;
    return {
      separateAudio: {
        models,
        available,
        ...(available ? {} : { unavailableReason: preferred.unavailableReason ?? 'not-installed' }),
        ...(!available ? detailOf(preferred) : {}),
      },
    };
  }

  /** 文生图的模型包：登记了才有这项能力；没有一个可用时整项不可用（原因取第一个的）。 */
  #imageCapability(all: ModelBundleStatus[]): { generateImage?: ProviderCapability<ImageModelInfo> } {
    const models = all
      .filter((s) => s.capability === 'image')
      .flatMap((status) => {
        const def = this.#catalog.definition(status.bundleId);
        if (!def?.image) return [];
        const usable = bundleUsable(status);
        const info = localImageModelInfo(def, status, usable);
        return [usable ? info : { ...info, unavailableReason: unavailableReasonOf(status) }];
      });
    if (models.length === 0) return {};
    const usable = models.filter((m) => m.available);
    const preferred = usable[0] ?? models[0]!;
    preferred.default = true;
    const available = usable.length > 0 && this.#image !== null;
    const reason: ProviderUnavailableReason | undefined = available
      ? undefined
      : this.#image === null
        ? 'unsupported'
        : (preferred.unavailableReason ?? 'not-installed');
    return {
      generateImage: {
        models,
        available,
        ...(reason ? { unavailableReason: reason } : {}),
        ...(!available ? detailOf(preferred) : {}),
      },
    };
  }

  #model(status: ModelBundleStatus, all: readonly ModelBundleStatus[]): TranscribeModelInfo {
    const def = this.#catalog.definition(status.bundleId);
    const usable = bundleUsable(status);
    const reason = usable ? undefined : unavailableReasonOf(status);
    const selfSegmenting = def?.components.asr?.family === 'moss-transcribe-diarize';
    // 「说话人区分」模型包的必需组件都装好了，转写之后能区分说话人（§6.6）；MOSS 自己区分。
    const pack = def?.diarization ? all.find((s) => s.bundleId === def.diarization) : undefined;
    const packInstalled = pack?.components?.filter((c) => !c.optional).every((c) => c.state === 'installed') ?? false;
    return {
      modelId: status.bundleId,
      label: status.label ?? status.bundleId,
      maxInputBytes: null,
      maxDurationSec: null,
      // 对齐器是可选组件：装好了词时间才是对齐出来的；没有时词按字符长度插值，标 `estimated`（§6.6 第 5 步）。自己切段的模型
      // （MOSS）只对齐长于 5 秒的行，其余的行仍是估计，不算原生词时间。
      wordTimestamps:
        !selfSegmenting && status.components?.some((c) => c.component === 'aligner' && c.state === 'installed') ? 'native' : 'none',
      // 断言的语言按 `asr` 的模型族把关（Worker 同样的表）；认不出的模型族不限。
      languages: asrLanguagesOf(def),
      // MOSS 没有识别提示的通道：不收提示（Worker 收到也只报 `hint-ignored`）。
      acceptsHint: !selfSegmenting,
      speakers: selfSegmenting ? 'native' : packInstalled ? 'pack' : 'none',
      ...(!selfSegmenting && def?.diarization ? { diarizationPack: def.diarization } : {}),
      cost: 'free-local',
      available: usable,
      ...(reason ? { unavailableReason: reason } : {}),
      ...(!usable ? detailOf(status) : {}),
    };
  }
}

function asrLanguagesOf(def: BundleDefinition | null): 'any' | string[] {
  const family = def?.components.asr?.family;
  const languages = family ? transcribeLanguages(family) : null;
  return languages ? [...languages] : 'any';
}

/** 模型包的状态 → 不可用的原因。 */
export function unavailableReasonOf(status: ModelBundleStatus): ProviderUnavailableReason {
  if (status.state === 'not-installed' || status.state === 'downloading') return 'not-installed';
  switch (status.reason) {
    case 'unsupported':
      return 'unsupported';
    case 'resource':
    case 'load-failed':
      return 'resource';
    case 'worker-missing':
      return 'not-installed';
    default:
      return 'not-installed';
  }
}

/** 不可用的原因连同它的消息引用一起带上（界面按自己的语言重新生成）。 */
function detailOf(from: { detail?: string; detailRef?: MessageRef } | undefined): { detail?: string; detailRef?: MessageRef } {
  if (!from?.detail) return {};
  return from.detailRef ? { detail: from.detail, detailRef: from.detailRef } : { detail: from.detail };
}
