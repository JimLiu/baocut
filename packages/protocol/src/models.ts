import type { Id } from './domain.ts';
import { ProtocolLabels } from './messages/protocol/protocol-labels.ts';
import type { MessageRef } from './message-ref.ts';

/**
 * 本地模型包的状态（架构设计 §6.3、§6.5）。`models.list` 返回它。
 *
 * 一个模型包是一个主模型及其固定依赖（VAD 等）在某个 backend 上的构建，例如 `qwen3-asr-0.6b@mlx-4bit`。
 */

/**
 * 模型包能做什么：`transcribe` / `align` 是语音识别的模型包，`synthesize` 是本地语音合成的模型包（对外即 `synthesizeSpeech`），
 * `separate` 是人声与伴奏分离的模型包（配音的 `separateAudio` 由它执行），`image` 是本地文生图的模型包（对外即 `generateImage`）。
 * `diarize` 是「说话人区分」模型包（Pyannote 分段 + WeSpeaker 声纹，架构设计 §6.6）：它自己不跑任务，装好之后不自带区分的
 * 识别模型包（Qwen3-ASR、Whisper）转写时带上它的组件、给段与词标说话人。
 */
export type ModelCapability = 'transcribe' | 'align' | 'synthesize' | 'separate' | 'image' | 'diarize';
/**
 * `mlx`、`coreml`（Whisper 的 CoreML 包）只在 Apple Silicon 的 macOS 上可用；`candle` 全平台；`ggml`（Whisper 的 whisper.cpp 包）
 * 全平台，Apple Silicon 上不列出。
 */
export type ModelBackend = 'mlx' | 'coreml' | 'candle' | 'ggml';

/**
 * - `not-installed`：清单缺失、文件缺失或大小不符，或校验 sha256 不过、加载时报告文件不对；部分组件已经装好、另一些缺失时
 *   `reason: 'incomplete'`，`components` 列出缺的是哪些（安装只补缺的组件，不整包重下）；
 * - `downloading`：安装或修复的任务在排队或进行中，`install` 带已收到的字节数；
 * - `installed`：文件齐全，Worker 没有加载它；
 * - `loading` / `ready` / `busy` / `unloading`：Worker 的状态；
 * - `error`：不可用，`reason` 说明原因（`unsupported`：这台机器的平台或后端不支持；`resource`：资源不足或反复崩溃后停用，
 *   `models.enable` 重新启用；`worker-missing`：没有找到 Model Worker 可执行文件）。
 *
 * 具体进度未知时不伪造百分比：总字节数未知时 `install.totalBytes` 为 null。
 */
export type ModelBundleState = 'not-installed' | 'downloading' | 'installed' | 'loading' | 'ready' | 'busy' | 'unloading' | 'error';

export type ModelBundleReason =
  | 'unsupported'
  | 'resource'
  | 'worker-missing'
  | 'missing-manifest'
  | 'missing-file'
  | 'size-mismatch'
  | 'hash-mismatch'
  | 'load-failed'
  | 'incomplete'
  /** 正在把模型移到新的模型目录（`models.setDir` 的 `move`）：移完之前不能用。 */
  | 'relocating';

export interface ModelBundleStatus {
  bundleId: string;
  capability: ModelCapability;
  /** 给人看的名字（每个登记的模型包都有；旧的快照可能没有，那时用 `bundleId`）。 */
  label?: string;
  /** 权重的许可：`commercialUse: false` 的模型包只许非商业用途，安装前要让用户看到。 */
  license?: ModelLicense;
  backend: ModelBackend;
  device: string;
  /** 必需组件的下载大小（字节），按内置清单；有组件没有登记清单时 null。装没装都给，供下载前显示大小（Runtime 总是给；旧的快照可能没有）。 */
  estimatedBytes?: number | null;
  state: ModelBundleState;
  reason?: ModelBundleReason;
  /** 给人看的补充说明（缺哪个文件、哪个平台）。不含本机绝对路径。 */
  detail?: string;
  /** `detail` 的消息引用（message-ref.ts）。 */
  detailRef?: MessageRef;
  /** 组成模型包的各个组件（主模型的权重与共享的 VAD、对齐器……）各自装好没有。 */
  components?: ModelComponentStatus[];
  /** 安装进度：正在下载，或上次停下时留在暂存区里的部分（`paused`，再次 `models.install` 从这里续传）。 */
  install?: ModelInstallProgress;
  /** 最近一次检查（`models.test`）的结果。 */
  selfTest?: ModelSelfTestResult;
}

/**
 * 模型包的一个组件：上游仓库的一个固定版本，装在 `<models-root>/<owner>/<repo>/`。几个模型包共用的组件（VAD 等）只装一份，
 * 按引用保留：删除模型包时只回收没有别的模型包在用的组件。
 */
export interface ModelComponentStatus {
  /** `asr`、`vad`、`aligner`…… */
  component: string;
  /** `<owner>/<repo>` */
  repo: string;
  revision: string;
  /** `installed`：清单与文件齐全；`missing`：没装或不完整（缺文件、大小不符、版本不对）。 */
  state: 'installed' | 'missing';
  /** 已经装好时它占的字节数（清单里的大小之和）；没装时 null。 */
  bytes: number | null;
  /** 同样用到这个组件（同一仓库与版本）的其他模型包。 */
  sharedWith: string[];
  /** 可选的组件（对齐器、说话人模型）：安装与修复照样下载，缺它时模型包仍算装好、照常可用。 */
  optional?: boolean;
  /**
   * 组件自己的许可（登记了才有；对齐器、说话人模型）。`CC-BY` 一类要署名的，署名写在 `summary` 里；供界面在模型详情的许可行列出
   * 与权重许可不同或要署名的组件。
   */
  license?: ModelLicense;
}

export interface ModelInstallProgress {
  /** 在途的安装或修复任务；`paused`（没有任务在跑）时 null。 */
  jobId: Id | null;
  state: 'queued' | 'downloading' | 'verifying' | 'paused';
  /** 已经收到并留在暂存区的字节（含以前续传前留下的部分）。 */
  receivedBytes: number;
  /** 这次要下载的总字节数；上游没有给出大小时 null（不伪造百分比）。 */
  totalBytes: number | null;
}

/** 最近一次检查（`models.test`）的结论。字段名沿用 `selfTest`。 */
export interface ModelSelfTestResult {
  state: 'passed' | 'failed';
  jobId: Id;
  /** 结束的时间。 */
  at: string;
  /** 失败的原因，或通过时识别出的文字（固定样本，不含用户内容）。 */
  detail?: string;
  /** `detail` 是 Runtime 的文案时的消息引用（message-ref.ts）：界面按自己的语言重新生成；识别出的文字、旧记录没有。 */
  detailRef?: MessageRef;
  /** 没通过的原因（只在 `failed` 时有）。旧的记录没有这一项，按认不得的原因处理。 */
  code?: ModelCheckCode;
  /** 没通过时的技术细节（`key: value` 一行一条：Worker 的错误码与说明、组件、文件、实际结果），给反馈问题用；不含本机绝对路径。 */
  facts?: string[];
}

/**
 * 检查没通过的原因（命令与协议规范 §11.3）。模型包上的 `selfTest.code`，以及 `modelTest` 任务失败时的 `error.details.check`
 * 用同一组值；任务的 `error.code` 仍是 `MODEL_SELF_TEST_FAILED`（`APP_FILE_MISSING` 除外）。
 * - `APP_FILE_MISSING`：随应用分发的文件（样本、内置音色的录音）缺失，是安装不完整，不是模型的问题（不记进 `selfTest`）；
 * - `MODEL_FILES_DAMAGED`：模型的文件缺失或损坏，Worker 加载不了；
 * - `MODEL_OUTPUT_WRONG`：模型能加载、能运行，但输出不对（不合合同、识别不出样本、合成是静音……）；
 * - `MODEL_OUT_OF_MEMORY`：内存不够，模型没能加载；
 * - `MODEL_WORKER_FAILED`：Model Worker 起不来、中途退出、不支持这只模型，或被停用。
 */
export const MODEL_CHECK_CODES = [
  'APP_FILE_MISSING',
  'MODEL_FILES_DAMAGED',
  'MODEL_OUTPUT_WRONG',
  'MODEL_OUT_OF_MEMORY',
  'MODEL_WORKER_FAILED',
] as const;
export type ModelCheckCode = (typeof MODEL_CHECK_CODES)[number];

/**
 * 修复（`models.repair`，只重新下载坏掉的文件）对这个原因有没有用：`yes` 文件坏了，修复能解决；`maybe` 输出不对，
 * 可能是文件坏了，值得先修复；`no` 不是模型文件的问题（应用自带的文件、内存、Worker）。认不得的代码是 `no`。
 */
export function modelCheckRepair(code: string | null | undefined): 'yes' | 'maybe' | 'no' {
  if (code === 'MODEL_FILES_DAMAGED') return 'yes';
  if (code === 'MODEL_OUTPUT_WRONG') return 'maybe';
  return 'no';
}

/** 认得的检查代码；别的（包括旧记录没有的）为 null。 */
export function modelCheckCode(value: unknown): ModelCheckCode | null {
  return typeof value === 'string' && (MODEL_CHECK_CODES as readonly string[]).includes(value) ? (value as ModelCheckCode) : null;
}

/**
 * 安装（或修复）一个模型包要做的事（`models.install` / `models.repair` 的第一步返回，架构设计 §6.3）：
 * 调用方把 `confirmBytes` 原样交回来才开始下载。
 */
export interface ModelInstallPlan {
  bundleId: string;
  /** 各组件：`installed` 不动；`missing` 下载缺的文件；`damaged`（修复时校验 sha256 不过）只重下坏的文件。 */
  components: Array<{
    component: string;
    repo: string;
    revision: string;
    action: 'keep' | 'download';
    /** 要下载的文件（相对仓库目录）。 */
    files: string[];
    /** 这个组件要下载的字节数；有文件大小未知时 null。 */
    bytes: number | null;
  }>;
  /** 这次要下载的总字节数（不含暂存区里已经收到的部分）；有文件大小未知时 null。 */
  downloadBytes: number | null;
  /** 大小未知时按登记的估计值给出的字节数（仅供参考）。 */
  estimatedBytes: number;
  /** 确认用的字节数：`downloadBytes`，未知时取 `estimatedBytes`。 */
  confirmBytes: number;
  /** 暂存区里已经收到、这次不再下载的字节数。 */
  resumedBytes: number;
  /** 模型目录所在磁盘的可用空间；查不到时 null。 */
  availableBytes: number | null;
  /** 下载来源的基址（不含凭据）。 */
  source: string;
  /** 没有要下载的东西（都已装好）。 */
  upToDate: boolean;
}

export interface ModelInstallResult {
  plan: ModelInstallPlan;
  /** 开始的安装任务；还没确认、或没有要下载的东西时 null。同一个模型包已经在安装时是那个任务。 */
  jobId: Id | null;
}

export interface ModelRemoveResult {
  /** 删掉的仓库（`<owner>/<repo>`）。 */
  removed: string[];
  /** 还有别的模型包在用、保留下来的仓库。 */
  kept: Array<{ repo: string; usedBy: string[] }>;
  bundle: ModelBundleStatus;
}

// ---- 模型目录（架构设计 §6.3、§5.10）：本地模型放在哪个文件夹 ----

/**
 * 生效的模型目录从哪里来：环境变量 `BAOCUT_MODELS_DIR`（只读，要改得改环境变量并重启）、设置 `models.dir`、
 * 或缺省的 `<runtime-home>/models`。
 */
export type ModelsDirSource = 'env' | 'setting' | 'default';

/** `models.getDir` 的结果：生效的模型目录与它的用量。 */
export interface ModelsDirInfo {
  /** 生效的模型目录（绝对路径）。 */
  path: string;
  source: ModelsDirSource;
  /** 缺省位置（`<runtime-home>/models`），「恢复默认」改回这里。 */
  defaultPath: string;
  /** 目录在不在（外置盘没接上时为 false：模型都显示为未安装，安装被拒绝）。 */
  exists: boolean;
  writable: boolean;
  /** 目录里能认出的模型仓库（带 `.bcut-manifest.json`）的大小之和，几个模型包共用的仓库只算一次。 */
  usedBytes: number;
  /** 所在磁盘的可用空间；读不到时 null。 */
  freeBytes: number | null;
  /** 组件全部在这个目录里的模型包个数（不看平台支不支持）。 */
  modelCount: number;
  /** 正在把模型移到新目录时那个任务（`kind: 'modelsMove'`）；没有时 null。 */
  moveJobId: Id | null;
  /** 那个移动的目标目录；没有时 null。 */
  moveTo: string | null;
}

/** 一个文件夹里认出的模型仓库：`<owner>/<repo>` 目录里带合法的 `.bcut-manifest.json`。 */
export interface ModelsDirRepo {
  repo: string;
  revision: string;
  /** 清单里的文件大小之和。 */
  bytes: number;
  /** 是不是登记过的模型包用到的仓库与版本（不是的不移动、不计入模型个数）。 */
  known: boolean;
}

/**
 * `models.inspectDir` 的结果：改到这个文件夹之前要知道的事。只读，不在文件夹里写任何东西。
 * `problem`：`missing` 不存在或不是文件夹，`not-writable` 没有写入权限，`nested` 与当前目录互相包含（不能移动或切换），
 * `same` 就是当前目录；null 表示可以改。
 */
export interface ModelsDirInspection {
  path: string;
  exists: boolean;
  writable: boolean;
  freeBytes: number | null;
  problem: 'missing' | 'not-writable' | 'nested' | 'same' | null;
  /** 这个文件夹里已有的模型。 */
  found: { repos: ModelsDirRepo[]; bundleIds: string[]; bytes: number };
  /** 当前目录里要移过去的模型（只算登记过的仓库）。 */
  current: { repos: ModelsDirRepo[]; bundleIds: string[]; bytes: number };
  /**
   * 选「移过去」时：要搬的字节数（目标里已有同一仓库与版本的不再搬）、同一块盘（改名，不占新空间）还是跨盘（复制、校验后删源），
   * 放不放得下。当前目录没有模型时 `requiredBytes` 为 0。
   */
  move: { requiredBytes: number; sameVolume: boolean; fits: boolean };
}

/**
 * 更改模型目录（`models.setDir`）的方式：
 * - `move`：把当前目录里登记过的模型仓库与安装记录移到新目录，再换过去（一个 `modelsMove` 任务）；
 * - `switch`：只换位置，原目录的文件原样保留，新目录里已有的模型直接可用，其余显示为未安装。
 * 当前目录没有模型时两者一样。
 */
export type ModelsDirMode = 'move' | 'switch';

export interface ModelsDirChangeResult {
  /** `switch` 之后（或 `move` 提交时）的目录信息；`move` 在任务完成后才换过去。 */
  dir: ModelsDirInfo;
  /** `move` 的任务；`switch` 时 null。 */
  jobId: Id | null;
}

// ---- 模型服务（架构设计 §6.1、§6.2、§6.8）：能力 × Provider ----

/**
 * 模型服务的能力。与上面模型包的 `ModelCapability`（本地模型包能做什么）是两个词表：这里是 Provider 对外提供的能力。
 * `transcribe` 有本地、节点与在线 Provider；`synthesizeSpeech` 有本地（已安装的语音合成模型包）与在线 Provider；`generateImage` 有本地（已安装的
 * 文生图模型包）、在线与智能体 Provider；
 * `generateText` 只有在线 Provider（局域网节点不共享它）；`separateAudio`（人声与背景分离）只有本地 Provider（已安装的分离模型包），
 * 由翻译配音使用。`transcribe` 与 `separateAudio` 有出厂默认，其余没有。
 */
export type ModelServiceCapability = 'transcribe' | 'synthesizeSpeech' | 'generateImage' | 'generateText' | 'separateAudio';
export const MODEL_SERVICE_CAPABILITIES: readonly ModelServiceCapability[] = [
  'transcribe',
  'synthesizeSpeech',
  'generateImage',
  'generateText',
  'separateAudio',
];

/**
 * 有在线 Provider 的能力：云端页、自建服务商声明的模型与对外模型接口（`/v1/*`）只涉及这几种。`separateAudio` 只在本机，不在其中。
 */
export type OnlineCapability = Exclude<ModelServiceCapability, 'separateAudio'>;
export const ONLINE_CAPABILITIES: readonly OnlineCapability[] = ['transcribe', 'synthesizeSpeech', 'generateImage', 'generateText'];

/**
 * Provider 的来源：`local`（本机 Model Worker）、`node`（已配对的局域网节点，`node:<nodeId>`）、
 * `online`（`openai`、`google`、`elevenlabs` 与用户自定义的兼容端点 `custom:<slug>`）、
 * `agent`（本机已安装并登录的智能体运行时，`agent:<driverId>`，首版只有 `agent:codex`，架构设计 §6.9）。
 */
export type ProviderKind = 'local' | 'node' | 'online' | 'agent';

/**
 * Provider 或模型此刻不可用的原因：
 * - `not-configured`：在线或智能体 Provider 没有启用（从未配置或被停用）；
 * - `missing-credential`：启用了但没有密钥；
 * - `not-installed`：本地模型包没有安装或文件不对；智能体 Provider：智能体运行时没有安装；
 * - `signed-out`：智能体运行时没有登录（在它自己的界面登录，BaoCut 不经手账号）；
 * - `outdated`：智能体运行时的版本低于这个 Provider 要求的最低版本；
 * - `not-paired` / `not-connected`：节点没有配对或连不上；
 * - `unsupported`：这台机器、这个节点或这个版本不支持；
 * - `resource`：反复崩溃或资源不足后停用（`models.enable` 重新启用）。
 */
export type ProviderUnavailableReason =
  | 'not-configured'
  | 'missing-credential'
  | 'not-installed'
  | 'signed-out'
  | 'outdated'
  | 'not-paired'
  | 'not-connected'
  | 'unsupported'
  | 'resource';

/** 各能力的模型描述都有的字段。本地与节点的 `modelId` 是模型包 ID，在线的是供应商的模型名。 */
export interface ModelInfoBase {
  modelId: string;
  label: string;
  /** 这个 Provider 在这种能力下的默认模型。 */
  default?: boolean;
  /** 用户声明的模型（自定义端点）：限制与特性由用户给出，按 `declared` 层对待（§3.6）。 */
  declared?: boolean;
  /** 本地与节点逐个模型包报告可用性；不给时与所在 Provider 相同。 */
  available?: boolean;
  unavailableReason?: ProviderUnavailableReason;
  detail?: string;
  /** `detail` 的消息引用（message-ref.ts）。 */
  detailRef?: MessageRef;
  /** 结构化字段说不清的限制，一句给人（与智能体）看的话，例如智能体 Provider 的串行与耗时（§6.9）。 */
  notes?: string;
  /**
   * 单价（可选）：只在服务商公布了可信的单价、由描述给出时才有，用来估算一次调用的金额上界（架构设计 §7.8）。
   * 没有时金额未知（`cost: 'unknown'`），有金额上限的授权不能保证上限。不写伪精确的价格；内置模型目前都没有。
   */
  price?: ModelPrice;
}

/** 单价：每次请求、每张图片或每千字符（合成语音的文本）多少钱。金额是十进制字符串。 */
export interface ModelPrice {
  currency: string;
  amount: string;
  unit: 'request' | 'image' | '1k-chars';
}

/**
 * 费用状态：本地免费（`free-local`）；在线的有可信的单价时 `estimate`，没有时 `unknown`；智能体 Provider 用的是用户
 * 已有的订阅，`subscription` 表示「订阅内，额度未知」。不写伪精确的金额。
 */
export type ModelCost = 'free-local' | 'estimate' | 'unknown' | 'subscription';

/** `transcribe` 的模型描述。 */
export interface TranscribeModelInfo extends ModelInfoBase {
  /** 单次请求的输入大小上限（字节）；null 为不限。超过时适配器切片提交。 */
  maxInputBytes: number | null;
  /** 单次请求的音频时长上限（秒）；null 为不限。 */
  maxDurationSec: number | null;
  /** `native`：返回词级时间；`none`：只有段级时间或没有时间，词时间按字符长度插值并标 `estimated`。 */
  wordTimestamps: 'native' | 'none';
  /** 支持的语言（BCP 47 主语言子标签）；`any` 为不限。 */
  languages: 'any' | string[];
  /** 是否接受术语提示（`hint`）。 */
  acceptsHint: boolean;
  /**
   * 能不能区分说话人（`diarize`）：`native` 是模型自己区分（MOSS），`pack` 是装了「说话人区分」模型包、转写后区分
   * （Qwen3-ASR、Whisper，架构设计 §6.6），`none` 是不区分（`diarize` 只报 `diarization-unavailable`）。没有这一项按 `none`。
   */
  speakers?: 'native' | 'pack' | 'none';
  /**
   * 转写后区分说话人要用的「说话人区分」模型包（`bundleId`）：Qwen3-ASR 与 Whisper 的本地模型包登记了它，装没装都给，
   * 界面据此知道装上它就能区分（`speakers` 只说此刻能不能）。自己区分的（MOSS）与在线模型不给。
   */
  diarizationPack?: string;
  cost: ModelCost;
}

/** 人声与背景分离的模型（本地的分离模型包）：输出人声与背景两条与输入等长、同采样率的音频（架构设计 §6.1）。 */
export interface SeparateModelInfo extends ModelInfoBase {
  cost: ModelCost;
}

/** 合成语音的输出格式（都是自带容器头、ffprobe 认得的格式；不提供裸 PCM）。 */
export type SpeechFormat = 'mp3' | 'wav' | 'flac';
export const SPEECH_FORMATS: readonly SpeechFormat[] = ['mp3', 'wav', 'flac'];

/** 生成图片的格式。 */
export type ImageFormat = 'png' | 'jpeg' | 'webp';
export const IMAGE_FORMATS: readonly ImageFormat[] = ['png', 'jpeg', 'webp'];

/**
 * 声音的指定方式：`preset` 是模型自带的音色（`voices` 里列出的）；`custom` 是供应商账号里的音色 ID（克隆、音色库），
 * 原样交给供应商，由它核对。本地模型还有两种：`clone` 是参考录音加原文（请求的 `reference`，或音色库条目
 * `library:<id>` 的参考录音），`describe` 是一句描述（请求的 `voiceDescription`）。模型不支持的方式在提交时拒绝，
 * 不换成别的声音。
 */
export type VoiceMode = 'preset' | 'custom' | 'clone' | 'describe';

export interface SpeechVoice {
  voiceId: string;
  label: string;
  /**
   * 本地克隆模型的内置音色：这只音色其实是一段随应用分发的参考录音（`builtin`），选它就是用这段录音克隆。
   * 模型自带的说话人（`model`）与在线音色不给。
   */
  source?: 'model' | 'builtin';
  /** 音色的语言（BCP 47 主语言子标签）；不限时不给。 */
  language?: string;
}

/** 本地语音合成的一个数值旋钮的范围（含两端）与默认值。 */
export interface SpeechKnobRange {
  min: number;
  max: number;
  step: number;
  default: number;
}

/**
 * 一句描述造声（`describe`）接受什么：`free` 为任意一句话；`vocabulary` 为封闭词表，每类至多选一项，词条用逗号分隔。
 * `terms` 的键是词条的语言（BCP 47 主语言子标签），同一类各语言的词条按下标一一对应；只有某种语言的类别只给那一种。
 */
export type SpeechVoiceDescription =
  { kind: 'free' } | { kind: 'vocabulary'; categories: Array<{ category: string; terms: Record<string, string[]> }> };

/** 模型权重的许可：下载与使用前给人看。`commercialUse: false` 的模型只许非商业用途。 */
export interface ModelLicense {
  name: string;
  url: string;
  commercialUse: boolean;
  /** 一句给人看的说明。 */
  summary: string;
}

/**
 * 读音标注（多音字）怎么交给模型：读音标注是输入文本的一部分，Runtime 原样交给 Worker，由引擎换成自己的写法。
 * `homophone`：换成同音字；`inline-pinyin`：行内拼音；`annotated`：模型原生的标注写法；`unsupported`：模型没有读音通道，
 * 按表面文字合成（如实报告，不静默改写）。
 */
export type SpeechReadings = 'homophone' | 'inline-pinyin' | 'annotated' | 'unsupported';

/** 本地语音合成模型（`local` Provider 的 `synthesizeSpeech` 模型）独有的描述。 */
export interface LocalSpeechTraits {
  /** 引擎的家族（`qwen3-tts`、`indextts2`……），给界面分组用。 */
  family: string;
  /** 输出的采样率（Hz）。输出一律是 WAV。 */
  sampleRate: number;
  /** 明显慢于其他本地模型（大模型），界面据此提示。 */
  slow: boolean;
  /**
   * 内置音色（`voices` 里 `source: 'builtin'` 的那些）怎么用：`reference` 是用它的参考录音与原文克隆，`description` 是把它的
   * 英文声音描述交给按描述造声的模型；没有内置音色时 null。
   */
  builtinVoices: 'reference' | 'description' | null;
  /** `clone` 的参考录音：建议时长（秒）；给了原文时的建议时长（有的模型给原文时要更短的参考）。 */
  reference: { recommendedSeconds: [number, number]; withTranscriptSeconds: [number, number] | null; acceptsTranscript: boolean } | null;
  /** `describe` 接受什么；不支持 `describe` 时 null。 */
  voiceDescription: SpeechVoiceDescription | null;
  /** `instructions` 的含义：`style` 为语气与风格说明（与音色无关）；不接受时 null。 */
  instructions: 'style' | null;
  /** 情绪控制（情绪参考音频、情绪向量）：引擎支持，这一版的请求还不带。 */
  emotion: boolean;
  /** 数值旋钮：`speed`（同 `speedRange`）、`cfg`（引导强度）、`steps`（扩散步数）。不接受的不给。 */
  knobs: Partial<Record<'speed' | 'cfg' | 'steps', SpeechKnobRange>>;
  /** 按目标时长合成的上限（秒）；不支持时 null。 */
  maxDurationSec: number | null;
  readings: SpeechReadings;
  license: ModelLicense;
}

/** `synthesizeSpeech` 的模型描述。 */
export interface SpeechModelInfo extends ModelInfoBase {
  /** 预置音色；供应商的音色随账号变化时可以为空（此时只接受 `custom`）。 */
  voices: SpeechVoice[];
  /** 不指定声音时用哪个；null 表示必须指定。 */
  defaultVoice: string | null;
  voiceModes: VoiceMode[];
  /** 支持的语言（BCP 47 主语言子标签）；`any` 为不限或供应商没有给出清单。 */
  languages: 'any' | string[];
  /** 单次请求的文本上限（按 Unicode 码点计）。超过时在提交时拒绝：不截断、不切块。 */
  maxInputChars: number;
  formats: SpeechFormat[];
  defaultFormat: SpeechFormat;
  /** 是否接受语气与风格的说明（`instructions`）。 */
  acceptsInstructions: boolean;
  /** 语速倍率的范围；null 为不接受 `speed`。 */
  speedRange: { min: number; max: number } | null;
  /** 是否接受 `seed`（供应商尽力复现，不保证）。 */
  acceptsSeed: boolean;
  cost: ModelCost;
  /** 本地语音合成模型独有的描述；在线模型不给。 */
  local?: LocalSpeechTraits;
}

/** 一种宽高比与它默认的像素尺寸。 */
export interface ImageAspectRatio {
  /** `W:H`，如 `16:9`。 */
  ratio: string;
  /** 只给宽高比时用的尺寸 `WIDTHxHEIGHT`。 */
  size: string;
}

/** `generateImage` 的模型描述。 */
export interface ImageModelInfo extends ModelInfoBase {
  /** 接受的尺寸 `WIDTHxHEIGHT`。 */
  sizes: string[];
  aspectRatios: ImageAspectRatio[];
  /** 不指定尺寸时用哪个；null 表示由供应商决定（`auto`）。 */
  defaultSize: string | null;
  /** 一次任务最多几张。 */
  maxCount: number;
  /** 提示词上限（按 Unicode 码点计）。超过时在提交时拒绝。 */
  maxPromptChars: number;
  formats: ImageFormat[];
  defaultFormat: ImageFormat;
  /** 模型是否接受参考图（以及最多几张）。这一版的 `models.generateImage` 还不带参考图，这里只描述模型。 */
  referenceImages: { max: number } | null;
  acceptsSeed: boolean;
  cost: ModelCost;
  /** 本地文生图模型独有的描述；在线模型不给。 */
  local?: LocalImageTraits;
}

/** 本地文生图模型的旋钮：去噪步数的范围与默认值（请求的 `steps`）。 */
export interface LocalImageTraits {
  steps: SpeechKnobRange;
}

/**
 * 文本模型的推理强度（架构设计 §6.8）。各供应商的写法由适配器换算（OpenAI 的 `reasoning_effort`、Gemini 的
 * `thinkingLevel`）。模型不支持请求的那一档时用最接近的一档（一样近时取高的），不支持推理强度的模型忽略它；
 * 两种情况都在结果里注明。
 */
export type TextEffort = 'minimal' | 'low' | 'medium' | 'high';
export const TEXT_EFFORTS: readonly TextEffort[] = ['minimal', 'low', 'medium', 'high'];

/** `generateText` 的模型描述。 */
export interface TextModelInfo extends ModelInfoBase {
  /** 上下文窗口（输入加输出，按 token 计）。 */
  contextTokens: number;
  /** 单次输出的 token 上限；请求的 `maxOutputTokens` 不能超过它。 */
  maxOutputTokens: number;
  /** 接受的推理强度；空表示不能调节（请求的 `effort` 被忽略并注明）。 */
  efforts: TextEffort[];
  /** 不指定推理强度时供应商用哪一档；不能调节时 null。 */
  defaultEffort: TextEffort | null;
  /** 是否接受按 JSON Schema 的结构化输出（`responseFormat.type: 'json'`）。 */
  structuredOutput: boolean;
  acceptsTemperature: boolean;
  /** 是否接受 `seed`（供应商尽力复现，不保证）。 */
  acceptsSeed: boolean;
  cost: ModelCost;
}

/** 每种能力的模型描述。 */
export interface ModelInfoByCapability {
  transcribe: TranscribeModelInfo;
  synthesizeSpeech: SpeechModelInfo;
  generateImage: ImageModelInfo;
  generateText: TextModelInfo;
  separateAudio: SeparateModelInfo;
}

/**
 * 只属于某一种能力的调用参数的默认值（架构设计 §6.8）。首版只有 `generateText`：
 * - `effort`：请求没给推理强度时用的那一档；null 表示交给模型自己的默认；
 * - `concurrency`：每个 Provider 同时进行的文本请求数（任务与进程内调用共用这个上限），默认 4。
 */
export interface TextCapabilityParameters {
  effort: TextEffort | null;
  concurrency: number;
}
export const DEFAULT_TEXT_CONCURRENCY = 4;
export const MAX_TEXT_CONCURRENCY = 32;

/** `models.setCapabilityParameters` 的参数：给出的字段替换，null 恢复默认，不给不变。 */
export interface SetCapabilityParametersRequest {
  capability: 'generateText';
  effort?: TextEffort | null;
  concurrency?: number | null;
}

/** 一个 Provider 在一种能力下的模型与可用性。 */
export interface ProviderCapability<M extends ModelInfoBase = ModelInfoBase> {
  models: M[];
  available: boolean;
  unavailableReason?: ProviderUnavailableReason;
  /** 给人看的补充说明。不含密钥与本机绝对路径。 */
  detail?: string;
  /** `detail` 的消息引用（message-ref.ts）。 */
  detailRef?: MessageRef;
}

export type ProviderCapabilities = { [C in ModelServiceCapability]?: ProviderCapability<ModelInfoByCapability[C]> };

/** Provider 描述（§6.1）：注册表里的条目，也是线上的形状。 */
export interface ProviderDescriptor {
  providerId: string;
  kind: ProviderKind;
  label: string;
  capabilities: ProviderCapabilities;
  /** 服务商目录的条目（在线与智能体 Provider 有，架构设计 §6.4）：界面据此分组、画图标、给出官网与 region。 */
  vendor?: ProviderVendorInfo;
}

/**
 * 服务商目录里的一项（架构设计 §6.4）：`vendor` 是模型厂商，`relay` 是中转平台，`custom` 是用户添加的 OpenAI 兼容端点，
 * `agent` 是智能体 Provider（§6.9）。`regions` 是有预设基址的地区（第一个是缺省），账号的 `region` 从中选；
 * `icon` 是界面图标的 id（不是文件路径），没有时界面用首字母头像。
 */
export interface ProviderVendorInfo {
  kind: ProviderVendorKind;
  regions?: string[];
  website?: string;
  icon?: string;
}
export type ProviderVendorKind = 'vendor' | 'relay' | 'custom' | 'agent';

/** 账号最近一次调用的结果（只记录，不据此自动换账号，§6.2）。 */
export type ProviderAccountState = 'ok' | 'invalid-key' | 'rate-limited' | 'quota-exhausted' | 'unknown';

export interface ProviderAccountStatus {
  state: ProviderAccountState;
  /** 记下这个状态的时间（ISO 8601）。 */
  at?: string;
  /** `rate-limited`：供应商给了 `Retry-After` 时推出的恢复时间。 */
  until?: string;
  /** 给人看的补充（不含密钥）。 */
  detail?: string;
  /** `detail` 的消息引用（message-ref.ts）。 */
  detailRef?: MessageRef;
}

/**
 * 一个在线 Provider 下的一个账号（一把密钥，架构设计 §6.8）。密钥永不回显，只有写入时算好的掩码（前 3 + … + 后 4；
 * 不超过 8 个字符时全是 •）。账号有序：一次调用用第一个启用且有密钥的账号，失败不换别的账号（§6.2）。
 */
export interface ProviderAccountView {
  accountId: string;
  /** 用户起的名字；null 时界面显示掩码。 */
  label: string | null;
  masked: string;
  enabled: boolean;
  /** 有 region 预设的服务商：账号用哪个地区的基址（目录的 `regions` 之一）。 */
  region?: string;
  /** 这个账号自己的基址覆盖（少见）：优先于服务商级的 `endpoint` 与目录的预设（§6.4）。 */
  endpoint?: string;
  addedAt: string;
  lastUsedAt?: string;
  /** 这个账号有没有密钥（凭据存储里查到的）。 */
  credential: 'set' | 'missing';
  status: ProviderAccountStatus;
}

/** 在线与智能体 Provider 的配置（只读视图）：密钥只报告有没有，从不回显。 */
export interface ProviderConfigView {
  enabled: boolean;
  /** 最近一次启用的时间：启用即是持续的授权（§6.2）。停用后为 null。 */
  enabledAt: string | null;
  /**
   * `set`：至少有一个启用且带密钥的账号；`missing`：没有；`none`：这个 Provider 不用密钥（智能体 Provider 用智能体运行时
   * 自己的登录）。
   */
  credential: 'set' | 'missing' | 'none';
  /** 账号（有序，§6.8）。在线 Provider 总是给出（可能为空）；智能体 Provider 没有，所以类型上可选。 */
  accounts?: ProviderAccountView[];
  /** 自定义端点的地址，或改写过的在线 Provider 基址；不给时用供应商的默认地址。 */
  endpoint?: string;
  /** 最近一次 `models.refreshProvider` 的结果；从没刷新过时没有。 */
  refreshed?: ProviderRefreshStatus;
}

/**
 * 向供应商取模型（与音色）列表的结果（`models.refreshProvider`，架构设计 §6.8）。列表只用来标注内置的模型：内置模型不在
 * 取到的列表里时报告为不可用（`unsupported`）；供应商账号里的音色补进没有预置音色的模型。取不到时 `ok: false`，
 * 照旧用内置的列表，`error` 说明原因（不含密钥）。
 */
export interface ProviderRefreshStatus {
  /** ISO 8601。 */
  at: string;
  ok: boolean;
  /** 取到的模型个数；失败时没有。 */
  models?: number;
  /** 取到的音色个数（有音色列表的供应商）；失败时没有。 */
  voices?: number;
  error?: string;
}

/** `models.configure` 返回的一个 Provider 的完整视图。 */
export interface ProviderView extends ProviderDescriptor {
  /** 只有在线与智能体 Provider 有配置；本地与节点为 null。 */
  config: ProviderConfigView | null;
}

/** 能力视图里的一个 Provider。 */
export interface ProviderCapabilityView<M extends ModelInfoBase = ModelInfoBase> extends ProviderCapability<M> {
  providerId: string;
  kind: ProviderKind;
  label: string;
  config: ProviderConfigView | null;
}

export interface ModelRef {
  providerId: string;
  modelId: string;
}

/** 一种能力的视图：用户默认值、不显式指定时实际会用的 Provider 与模型、各 Provider。 */
export interface CapabilityView<C extends ModelServiceCapability = ModelServiceCapability> {
  /** 用户设的默认值；指向的 Provider 不可用时照样保留（§6.8）。例外：删除本地模型包时，没有出厂默认的能力里指向它的默认值清除。 */
  default: ModelRef | null;
  /** 不显式指定时用哪个（§6.2 的第 2、3 条）；用户默认值不可用、或什么都没有时为 null，此时调用以 `CAPABILITY_NOT_CONFIGURED` 拒绝。 */
  effective: (ModelRef & { source: 'user-default' | 'factory-default' }) | null;
  providers: ProviderCapabilityView<ModelInfoByCapability[C]>[];
  /** 这种能力的参数默认值（只有 `generateText` 有），已经补上了出厂值。 */
  parameters?: TextCapabilityParameters;
}

export type ModelCapabilitiesView = { [C in ModelServiceCapability]: CapabilityView<C> };

/** `CAPABILITY_NOT_CONFIGURED` 的 `reason`。`signed-out` 与 `outdated` 只出自智能体 Provider（§6.9）。 */
export type CapabilityNotConfiguredReason =
  | 'no-default'
  | 'missing-credential'
  | 'not-installed'
  | 'signed-out'
  | 'outdated'
  | 'not-paired'
  | 'not-connected'
  | 'unsupported'
  | 'disabled';

/**
 * 能力没有可用的 Provider 时（§6.2）：`RpcError` 的 `code` 为 `conflict`，`details` 为这个形状。在提交时拒绝，不创建任务。
 * `remedy.hint` 是一句给人看的话（Runtime 的语言），`hintRef` 是它的消息引用。
 */
export interface CapabilityNotConfiguredDetails {
  code: 'CAPABILITY_NOT_CONFIGURED';
  capability: ModelServiceCapability;
  reason: CapabilityNotConfiguredReason;
  providerId?: string;
  remedy: {
    /** `setup-agent`：在智能体运行时自己的界面安装、登录或升级它（`reason` 说明是哪一样），BaoCut 不代做。 */
    action: 'configure-provider' | 'set-default' | 'install-model' | 'pair-node' | 'enable-provider' | 'setup-agent';
    providerId?: string;
    capability: ModelServiceCapability;
    hint: string;
    hintRef?: MessageRef;
  };
}

/** Agent 提示用户配置能力时使用的设置深链（产品设计 §3.2.2），与界面内路由一致。 */
export function capabilitySettingsHref(capability: ModelServiceCapability): string {
  const category: Record<ModelServiceCapability, string> = {
    transcribe: 'asr', synthesizeSpeech: 'tts', generateText: 'llm', generateImage: 'image', separateAudio: 'sep',
  };
  return `/settings/models/${category[capability]}`;
}

/** 每种能力可以配置的在线 Provider（补救命令里的占位）。 */
function configurableProviders(capability: ModelServiceCapability): string {
  const custom = ProtocolLabels.customProviderPlaceholder().text;
  switch (capability) {
    case 'transcribe':
    case 'generateImage':
    case 'generateText':
      return `openai|google|${custom}`;
    case 'synthesizeSpeech':
      return `openai|elevenlabs|${custom}`;
    case 'separateAudio':
      // 没有在线 Provider：补救只有安装本机模型包或设默认值。
      return 'local';
  }
}

/** 智能体 Provider 的 `providerId` 前缀（`agent:<driverId>`）。 */
export const AGENT_PROVIDER_PREFIX = 'agent:';

/**
 * `CAPABILITY_NOT_CONFIGURED` 的补救办法换成 CLI 命令（每条一行，可能为空）。CLI 打印它们；智能体工具把它们连同
 * `remedy.hint` 交给智能体，由智能体转告用户。密钥只从标准输入读，命令里从不出现。
 */
export function capabilityRemedyCommands(details: CapabilityNotConfiguredDetails): string[] {
  const providerId = details.remedy.providerId ?? details.providerId;
  const configure = `baocut models configure <${configurableProviders(details.capability)}> --enable --key-stdin --verify < key.txt`;
  const install = [`baocut models list  ${ProtocolLabels.bundlesCommandNote().text}`, 'baocut models install <bundleId>'];
  // 人声分离只有本机模型包：没有可以配置的在线 Provider，补救只有安装（或设默认值）。
  if (
    details.capability === 'separateAudio' &&
    (details.remedy.action === 'configure-provider' || details.remedy.action === 'install-model')
  ) {
    return install;
  }
  switch (details.remedy.action) {
    case 'configure-provider':
      // 智能体 Provider 没有密钥，配置它就是启用它。
      if (providerId?.startsWith(AGENT_PROVIDER_PREFIX)) return [`baocut models configure ${providerId} --enable`];
      return [providerId ? `baocut models configure ${providerId} --enable --key-stdin --verify < key.txt` : configure];
    case 'enable-provider':
      return providerId ? [`baocut models configure ${providerId} --enable`] : [];
    case 'set-default':
      return [`baocut models default ${details.capability} ${providerId ?? '<providerId>'}`];
    case 'pair-node':
      return [`baocut nodes pair ${ProtocolLabels.pairCommandArgs().text}`];
    case 'install-model':
      // 本机模型包：先看要装哪个，安装前会显示大小并要求确认；也可以改用在线服务。
      return [...install, configure];
    case 'setup-agent':
      // 安装、登录与升级都在智能体运行时自己的界面里完成（架构设计 §3.11）；`hint` 说明怎么做。
      return [];
  }
}

/**
 * 自定义端点声明的模型；没给的字段取保守的默认值。`capability` 不给时是 `transcribe`。
 * - `transcribe`：25 MB、不限时长、尝试取词级时间、接受提示词；
 * - `synthesizeSpeech`：`voices` 的第一个是默认音色（没有时必须指定，接受任意音色 ID），文本 4096 字符，`mp3`；
 * - `generateImage`：`sizes` 的第一个是默认尺寸（没有时 `1024x1024`），一次 1 张，提示词 4000 字符，`png`；
 * - `generateText`：上下文 32768 token、单次输出 4096 token，不能调推理强度（声明了 `efforts` 时才发），接受结构化输出与
 *   `temperature`，不接受 seed。
 */
export interface DeclaredModel {
  modelId: string;
  label?: string;
  capability?: OnlineCapability;
  maxInputBytes?: number;
  maxDurationSec?: number | null;
  wordTimestamps?: 'native' | 'none';
  acceptsHint?: boolean;
  voices?: string[];
  maxInputChars?: number;
  formats?: SpeechFormat[];
  sizes?: string[];
  maxCount?: number;
  maxPromptChars?: number;
  contextTokens?: number;
  maxOutputTokens?: number;
  efforts?: TextEffort[];
  structuredOutput?: boolean;
}

/** `models.configure` 的参数。`credential` 只写：字符串设置，null 清除，不给不变。 */
export interface ConfigureProviderRequest {
  providerId: string;
  enabled?: boolean;
  credential?: string | null;
  /** 自定义端点首次配置时必填；内置的在线 Provider 可以改写基址（代理、自建网关），null 恢复默认。 */
  endpoint?: string | null;
  /** 自定义端点声明的模型（整体替换）。 */
  models?: DeclaredModel[];
  /** 自定义端点的显示名。 */
  label?: string;
  /** 保存前用新的密钥与端点向供应商验证一次（只读请求）；不通过时不保存。 */
  verify?: boolean;
}

/** `models.addAccount`：给一个在线 Provider 加一个账号（加在最后）。`verify` 时先用这把密钥向供应商发一个只读请求。 */
export interface AddProviderAccountRequest {
  providerId: string;
  credential: string;
  label?: string;
  region?: string;
  endpoint?: string;
  verify?: boolean;
}

/** `models.updateAccount`：给出的字段替换；`label`、`region`、`endpoint` 为 null 时清除。 */
export interface UpdateProviderAccountRequest {
  providerId: string;
  accountId: string;
  label?: string | null;
  credential?: string;
  enabled?: boolean;
  region?: string | null;
  endpoint?: string | null;
  /** 换了密钥时先用新的密钥验证（列模型），不通过就不保存（`conflict`，`details.code` 为 `PROVIDER_*`）。 */
  verify?: boolean;
}

/** `models.arrangeAccounts`：账号的新顺序，要恰好是现有账号的一个排列。 */
export interface ArrangeProviderAccountsRequest {
  providerId: string;
  order: string[];
}

export interface ModelsSnapshot {
  capabilities: ModelCapabilitiesView;
  /** 本地模型包的状态（与 `models.list` 相同）。 */
  bundles: ModelBundleStatus[];
}

/**
 * `capabilities.updated`：配置、默认值、模型包或节点变化时发一条，带完整的新视图。
 * `bundle.updated`：一个本地模型包的状态变了（下载进度、安装、删除、检查、Worker 的加载与卸载），带它的完整状态。
 */
export type ModelsEvent =
  { type: 'capabilities.updated'; capabilities: ModelCapabilitiesView } | { type: 'bundle.updated'; bundle: ModelBundleStatus };
