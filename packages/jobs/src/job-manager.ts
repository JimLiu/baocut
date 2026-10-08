import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_TEXT_CONCURRENCY,
  RpcError,
  TEXT_PREVIEW_CHARS,
  newId,
  nowIso,
  type ApplicationRecord,
  type EditOperation,
  type GenerateImageRequest,
  type GenerateTextRequest,
  type GeneratedOutput,
  type FrozenSpeechReference,
  type GenerationParameters,
  type JobLibraryUse,
  type Id,
  type JobCancellation,
  type JobError,
  type JobCommandRun,
  type JobGrantUse,
  type JobPhase,
  type JobProgress,
  type JobReconcileDecision,
  type JobRecord,
  type JobState,
  type JobSubmitter,
  type JobWarning,
  type JobLiveSegment,
  type JobsSnapshot,
  type LanguageRequest,
  type ModelInfoBase,
  type ModelServiceCapability,
  type ProviderKind,
  type SynthesizeSpeechRequest,
  type TextJobResult,
  type TranscribeRequest,
  type TranscriptReplace,
  type DocumentRecord,
} from '@baocut/protocol';
import { compileJsonSchema } from '@baocut/protocol/json-schema';
import {
  ASR_RESULT_SCHEMA,
  DEFAULT_TIMESCALE,
  ProviderFailure,
  builtinReferenceFile,
  bundleUsable,
  canonicalLanguageTag,
  capabilityNotConfiguredError,
  checkTranscribeOptions,
  imageParameters,
  freezeReferenceFile,
  localImageSeed,
  planLocalVoice,
  speechParameters,
  textParameters,
  validateAsrResult,
  type AsrResult,
  type GenerationCapability,
  type GenerationOutputFile,
  type GenerationProvider,
  type GenerationSelection,
  type GenerationSink,
  type GenerationTarget,
  type JobOutput,
  type ModelCatalog,
  type ProviderQueue,
  type TextParameters,
  type TextResult,
  type TickRange,
  type TranscribeProvider,
  type TranscribeSelection,
  type TranscribeSink,
  type TranscribeTarget,
  type WorkerFootprint,
} from '@baocut/models';
import { ApplicationLedger, type StoredApplication, type VideoPlace } from './application-ledger.ts';
import { ArtifactStore, artifactIdOf, collectArtifactIds, type ArtifactExtension } from './artifact-store.ts';
import { generatedImportOperation } from './generated-import.ts';
import { JobsManager as J } from '@baocut/protocol/messages/jobs/job-manager.ts';
import { LocalizedError, asLocalized, errorText, jobError, jobWarning, withCause, type JobText } from './job-text.ts';
import {
  canonicalJson,
  generationInputHash,
  sha256Hex,
  transcribeInputHash,
  type GenerationInputSpec,
  type TaskInputSpec,
  type TranscribeInputSpec,
} from './input-hash.ts';
import { JobLedger, isTerminal, type HostedJobSpec, type PublishIntent, type StoredJob } from './job-ledger.ts';
import { isJobError, type JobAdmission, type JobGrantHint } from './job-admission.ts';
import {
  ApplicationRunner,
  SimulatedCrash,
  StaleInput,
  applicationOpen,
  type AppliedReceipt,
  type ApplicationRun,
  type ApplicationTarget,
  type JobFaultPoint,
  type JobFaults,
} from './job-application.ts';
import { reconcileChoices, reconcileNotAllowed } from './job-reconcile.ts';
import {
  cancellationFacts,
  isExternalProvider,
  recoveryAction,
  retryable,
  type RecoveryAction,
  type RemoteTaskQuery,
} from './job-recovery.ts';
import { libraryVoice, localLibraryVoice, transcribeGlossaries, type JobLibrary } from './job-library.ts';
import { silentLog, type JobsLogger } from './jobs-logger.ts';
import { localImageResources, localTranscribeResources } from './resource-profiles.ts';
import {
  ResourceExceedsCapacity,
  ResourceScheduler,
  type ResourceLease,
  type ResourceRequest,
  type ResourceTicket,
} from './resource-scheduler.ts';
import { unavailableProbe, type MediaFacts, type MediaProbe } from './media-probe.ts';
import { speechDocumentOperation } from './speech-document.ts';
import { contentFingerprint, nextRevision, planTranscriptSwitch } from './transcript-switch.ts';
import { JobsTranscribe } from '@baocut/protocol/messages/jobs/transcribe.ts';
import { EditorWasmError } from '@baocut/editor-wasm';
import { ensureSaveDirectory, readableStem } from './pipelines/save-location.ts';
import { publishFile } from './pipelines/transcode.ts';

/**
 * JobManager（架构设计 §7）：语音识别任务的账本、排队、执行、校验、发布与应用。
 *
 * 一次转写：选择 Provider 与模型（§6.2，经 `TranscribeRouter`）→ 冻结输入（素材版本、内容摘要、语言、Provider 与模型）
 * → 排队（每个队列 FIFO）→ Provider 执行
 * → 读 staging 里的 `result.json`，核对摘要与长度、按合同校验 → 发布为内容寻址的产物 → 应用：确认素材没变，
 * 以 `system` 身份写一份 `speech` 文档（§7.3）。staging 在任务终结时删除；校验不过的原始结果移到诊断目录。
 *
 * 任务期间持有视频的租约，视频不会因为界面断开而关闭。Worker 崩溃时自动再试一次（§6.5）；Runtime 重启时按恢复矩阵
 * （§7.5，`job-recovery.ts`）处理还没终结的任务：不续跑执行，没开始的重新校验后排队，结果不明的外发调用等用户对账。
 *
 * 执行与应用分开（§7.1–§7.3）：产物发布之后，「应用到视频」是另一条记录（`ApplicationRecord`，应用账本
 * `applications.jsonl`），先落账再提交事务、提交后记回执；重启后先按记下的 `commandId` 查回执，不重复写。
 * 外发调用的预算在产物发布时结算：之后应用成不成功都不影响预算，补做应用不重新调用、不重复计费。
 *
 * Provider 由注册表决定（`ModelServices`）：本机（`local`）每个模型包一个队列、一次一个；已配对的局域网节点
 * （`node:<nodeId>`，§6.7）每个节点一个队列、一次一个（节点自己排队），不检查本机的模型目录；在线 Provider
 * （`openai`、`google`、`custom:<slug>`，§6.4）每个 Provider 一个队列，并发上限由 Provider 给出（默认 2），不碰本机的
 * 模型包队列与模型目录。结果回来后一律校验、发布、应用。节点的拒绝与失联不重试（`REMOTE_NODE_REJECTED` /
 * `REMOTE_NODE_LOST`），节点上任务自己的失败保留节点给出的错误码，`details.node` 记下节点。在线 Provider 的拒绝
 * （`PROVIDER_AUTH_FAILED`、`PROVIDER_QUOTA_EXCEEDED`、`PROVIDER_REJECTED`）与不可用（`PROVIDER_UNAVAILABLE`，
 * 适配器已经退避重试过）都不在这里重试。
 *
 * 生成任务（`synthesizeSpeech`、`generateImage`，§6.6）：提交时选择 Provider 与模型、按模型的特性检查并冻结参数
 * （超过上限的文本在提交时拒绝，不截断、不分段）→ 排 Provider 的队列 → Provider 把输出写进 staging → 核对摘要与长度、
 * 按文件头核对格式、ffprobe 解码（音频报告时长、采样率、声道，图片报告宽高）→ 发布为产物 → 给了视频时以 `system:jobs`
 * 身份在一笔事务里导入为候选素材（不放上时间线）。文本生成（`generateText`）走同样的提交与排队，执行者是共用并发上限的
 * `TextJobGenerator`，结果是 UTF-8 文本（结构化输出再按 schema 校验一次），发布为 `.txt` / `.json` 产物，不导入视频。
 * 只按 `commandId` 去重：同样参数的两次提交是两个任务。不自动重试，
 * 不换模型或声音。
 *
 * 不经模型的任务（`submitTask`，首个是导出，§9.11）：调用方在提交前冻结输入、做完预检，交来一个执行函数；这里只管
 * 账本、排队、staging、取消与终态。执行函数正常返回就是完成（文件已经发布，不再因为取消改写成「已取消」），
 * 抛 `TaskFailure` 是失败，信号中止后抛出的是取消或中断。执行函数只在内存里：Runtime 重启后标为 `interrupted`。
 *
 * 另一种任务目标是「文件」（`submitFile`，局域网节点代别的机器执行的远端任务，§6.7）：输入是调用方给的文件与内容摘要，
 * 排同一个队、走同一个 Provider、同样的崩溃重试与输出校验，校验通过后把结果文件交还调用方就结束——不发布产物，
 * 不碰任何视频。记录里没有视频与素材，`result` 为 null；结果与转写文本都不进账本、日志与诊断目录。
 */

/** 素材版本的输入：文件的绝对路径与版本记录。 */
export interface JobAssetSource {
  file: string;
  revision: string;
  contentHash: string;
  mediaType: string;
}

/** JobManager 需要的视频能力；由 Runtime 用 VideoService 实现。 */
export interface JobVideos {
  /** 任务期间让视频保持打开。 */
  retain(videoId: Id): void;
  release(videoId: Id): void;
  /** 素材版本的文件与记录；视频没打开、素材或版本不存在时抛 `RpcError`。 */
  source(videoId: Id, assetId: Id, revision?: string): Promise<JobAssetSource>;
  /** 视频此刻的版本与素材的当前版本；视频没打开时为 null，素材不在时 `asset` 为 null。 */
  current(videoId: Id, assetId: Id): { videoRevision: string; asset: { revision: string; contentHash: string } | null } | null;
  /** 视频此刻的版本；没打开时 null。 */
  videoRevision(videoId: Id): string | null;
  /** 以 Runtime 自己（`system`）的身份提交一笔编辑；`run` 是这次执行（引擎侧的停止屏障，§7.4）。 */
  apply(
    videoId: Id,
    request: { commandId: Id; expectedRevision: string; operations: EditOperation[]; label: string; run?: ApplicationRun },
  ): Promise<{ refs?: Record<string, Id>; transactionId?: Id; videoRevision?: string }>;
  /** 已打开视频的位置（记进账本，重启后重新打开用）；没打开时 null。 */
  place?(videoId: Id): VideoPlace | null;
  /**
   * 按记下的位置重新打开视频并持有一个租约（之后 `release`）。目录不见了是 `missing`，那里换成了别的视频是 `mismatch`
   * （两者都不持有租约）；打不开（被别的进程锁着、引擎不可用）时抛出。
   */
  reopen?(videoId: Id, place: VideoPlace): Promise<'opened' | 'missing' | 'mismatch'>;
  /** 按 `commandId` 向引擎查已经提交的事务的回执；没有时 null。视频要已经打开。 */
  receipt?(videoId: Id, commandId: Id): Promise<AppliedReceipt | null>;
  /**
   * 引擎侧的停止屏障（§7.4）：请求在调用时同步发出，之后到达引擎的这一执行这一代的提交被拒（`TASK_STOPPED`）。
   * 兑现时，之前已经交给引擎的提交都有了结果；视频没打开、引擎不在时兑现 false（只剩 Node 侧的屏障）。
   */
  invalidateRun?(videoId: Id, run: ApplicationRun): Promise<boolean>;
  /** 视频此刻的版本与文档记录；没打开时 null。换用文稿（`TranscribeRequest.replace`）要它，没有时换用被拒绝。 */
  state?(videoId: Id): { revision: string; documents: Record<Id, DocumentRecord> } | null;
  /** 一份文档某个版本（不给时当前版本）的正文。换用文稿要它。 */
  document?(videoId: Id, documentId: Id, revision?: string): Promise<{ revision: string; body: unknown }>;
}

/** 文件目标的转写任务（远端任务）。 */
export interface FileTranscribeRequest {
  /** 调用方给定的任务 ID（节点服务用它自己的任务 ID，两边一致）；不给时新生成。 */
  jobId?: Id;
  /** 输入文件的绝对路径。 */
  file: string;
  /** 调用方核对过的内容摘要 `sha256:<hex>`。 */
  contentHash: string;
  bundleId: string;
  /** 不给时 `{ mode: 'prefer', tag: null }`。 */
  language?: LanguageRequest;
  track?: number;
  /** 只处理这一段，tick（`timescale`）。 */
  range?: { start: number; end: number } | null;
  diarize?: boolean;
  hint?: string | null;
  /** 输出的 tick 单位，默认 1_000_000。 */
  timescale?: number;
  /** 校验通过的 `result.json` 移到这里（绝对路径，调用方负责删除）。 */
  resultFile: string;
}

/**
 * 没有视频的转写（§7.9，例如模型接口服务的一次请求）：输入是一个文件，Provider 与模型按 §6.2 选择，
 * 原始结果发布为产物（生成记录），不应用到任何视频。内容摘要由这里按文件算，不信任调用方。
 * 文件在任务终结之前要一直在（调用方等 `settled` 之后再删）。
 */
export interface StandaloneTranscribeRequest {
  /** 输入文件的绝对路径。 */
  file: string;
  /** 文件的媒体类型（音频或视频）；不知道时不给。 */
  mediaType?: string | null;
  provider?: string;
  model?: string;
  /** 不给时 `{ mode: 'prefer', tag: null }`。 */
  language?: LanguageRequest;
  /** 术语与上下文，≤ 1200 字符。 */
  hint?: string;
  track?: number;
}

export interface FileJobOutput {
  file: string;
  /** 小写十六进制，不带前缀。 */
  sha256: string;
  byteLength: number;
}

/** 文件目标任务的观察者：`jobs` 主题的记录之外，调用方还要的事实。都不携带转写文本。 */
export interface FileJobObserver {
  warning?(warning: JobWarning): void;
  language?(tag: string, confidence: number | null): void;
  /** Worker 崩溃，自动重试：在记录标为 `interrupted` 之前调用，`attempt` 是新的尝试序号。 */
  retrying?(attempt: number): void;
  /** 结果已校验并移到 `resultFile`：在终态的记录发出之前调用。 */
  output?(output: FileJobOutput): void;
}

type JobTarget = { kind: 'video' } | { kind: 'file'; resultFile: string; observer: FileJobObserver };

export interface JobManagerPaths {
  /** `<home>/store/jobs.jsonl`；应用账本是同目录的 `applications.jsonl`。 */
  jobsFile: string;
  /** `<home>/staging`；每个任务在 `jobs/<jobId>/` */
  stagingDir: string;
  /** `<home>/artifacts` */
  artifactsDir: string;
  /** `<home>/logs/diagnostics` */
  diagnosticsDir: string;
}

/** 不经模型的任务的一次执行：staging 目录（已经建好，任务终结时删除）、取消信号与进度回报。 */
export interface TaskRun {
  jobId: Id;
  staging: string;
  signal: AbortSignal;
  phase(phase: JobPhase, progress?: JobProgress | null): void;
  warn(warning: JobWarning): void;
  /** 代用户执行的命令与它此刻的输出（`JobRecord.command`）。 */
  command(run: JobCommandRun): void;
}

/** 不经模型的任务的提交：冻结的规格、公开记录里的字段、队列与执行函数。 */
export interface TaskSubmission {
  kind: JobRecord['kind'];
  spec: TaskInputSpec;
  videoId: Id | null;
  contentHash: string;
  inputHash: string;
  providerId: string;
  modelId: string;
  /** 任务用到的本地模型包（模型包的安装与自检）；`models.remove` 据此判断模型包是否在用。 */
  bundleId?: string;
  /** 记录里的附加信息（导出的设置与快照；用到的库条目，任务终结时解除固定）。 */
  extra?: Pick<JobRecord, 'export' | 'library'>;
  commandId?: Id;
  queue: { key: string; concurrency: number };
  /**
   * 峰值需求（架构设计 §7.7，估计集中在 `resource-profiles.ts`）：准入之后才开始执行。不给时只受队列的并发约束。
   * 超过这台机器的容量时提交即被拒绝（`RESOURCE_ADMISSION_UNSATISFIABLE`）。
   */
  resources?: TaskResources;
  run(run: TaskRun): Promise<NonNullable<JobRecord['result']>>;
}

/** 任务的峰值需求：自己的量、共用的 holder（例如模型包的 Model Worker）与优先级。 */
export type TaskResources = Pick<ResourceRequest, 'demand' | 'holder' | 'priority'>;

/** 任务失败：错误码、说明与详情进 `JobRecord.error`；`result` 是失败前已经发布的输出（部分失败时）。 */
export class TaskFailure extends LocalizedError {
  readonly code: string;
  readonly details: unknown;
  readonly result: JobRecord['result'];

  constructor(code: string, message: JobText, details?: unknown, result: JobRecord['result'] = null) {
    super(message);
    this.code = code;
    this.details = details;
    this.result = result;
  }
}

/** Provider 的选择与执行者（`ModelServices` 实现它）。 */
export interface TranscribeRouter {
  /** 提交时选择 Provider 与模型；不可用时抛 `CAPABILITY_NOT_CONFIGURED`，不认识的 Provider 或模型 `not-found`。 */
  selectTranscribe(target: TranscribeTarget): Promise<TranscribeSelection>;
  /** 一个 `providerId` 的执行者（文件目标的任务只用 `local`）。 */
  transcriber(providerId: string): TranscribeProvider | null;
  /** 所有执行者：停止时关闭，重新启用模型包时通知。 */
  executors(): TranscribeProvider[];
  /** 提交时选择生成能力的 Provider 与模型；没有出厂默认，什么都没配置时抛 `CAPABILITY_NOT_CONFIGURED`。 */
  selectGeneration?<C extends GenerationCapability>(capability: C, target: GenerationTarget): Promise<GenerationSelection<C>>;
  /** 所有生成执行者：停止时关闭。 */
  generators?(): GenerationProvider[];
}

export interface JobManagerOptions {
  paths: JobManagerPaths;
  catalog: ModelCatalog;
  router: TranscribeRouter;
  videos: JobVideos;
  log?: JobsLogger;
  /** 终结的顶层任务保留多少条（默认 200）；固定流程的步骤（带 `parentJobId` 的子任务）随父任务保留与淘汰，不计数。 */
  maxRetainedJobs?: number;
  /**
   * 失败、取消或中断、还能重试的固定流程另外保留多少条（默认 50，不占 `maxRetainedJobs` 的名额）：最新的这些不淘汰，
   * 更旧的按普通任务淘汰。
   */
  maxRetainedRetryablePipelines?: number;
  /** 生成输出的解码校验（ffprobe）。不给时生成任务的输出一律校验不过。 */
  probe?: MediaProbe;
  /** 用户库（架构设计 §5.9）：术语表进识别提示、`library:<id>` 音色。没有时这两种请求被拒绝。 */
  library?: JobLibrary;
  /** 外发调用的授权与预算（架构设计 §12.5、§7.8）。没有时不检查（测试、单独使用）。 */
  admission?: JobAdmission;
  /** 可查询的远端任务（§7.5）。现有的 Provider 都不支持，留着接口。 */
  remoteTasks?: RemoteTaskQuery;
  /** 故障注入（测试用）：在应用闭环的几个时刻模拟崩溃。 */
  faults?: JobFaults;
  /** 资源调度（架构设计 §7.6、§7.7）：与 Provider 的进程共用一个。不给时按本机容量新建一个。 */
  resources?: ResourceScheduler;
}

/**
 * 托管任务（固定流程的父任务与步骤，§7.9）的宿主：JobManager 只记账、发事件、落盘，执行由宿主自己负责。
 * `cancel` 是 `jobs.cancel` 转来的请求，`interrupt` 是 Runtime 停止；两者都要求宿主尽快以 `finish` 结束这个任务。
 */
export interface HostedJobControl {
  cancel(): void;
  interrupt(): void;
}

/** 宿主改写一个托管任务的句柄。 */
export interface HostedJob {
  readonly jobId: Id;
  /** 记录的副本。 */
  record(): JobRecord;
  /** 改记录并发事件；`persist` 时同时写账本（状态与步骤的变化），进度这类高频变化不写。 */
  update(patch: Partial<JobRecord>, options?: { persist?: boolean }): void;
  /** 结束：写终态、落盘、唤醒 `settled`。已经结束时什么也不做。 */
  finish(state: Exclude<JobState, 'queued' | 'running'>, patch?: { error?: JobError; result?: JobRecord['result'] }): Promise<void>;
}

interface Entry extends StoredJob {
  /** 冻结的执行参数（不进公开记录）。 */
  input: { file: string; mediaType: string | null; track: number; hint: string | null; range: TickRange | null; timescale: number };
  target: JobTarget;
  commandId: Id | null;
  /**
   * 执行者与队列（在途的任务才有；从账本读回的终态任务为 null）。转写任务有 `transcriber`，生成任务有 `generator`，
   * 不经模型的任务有 `task`。
   */
  executor: {
    transcriber?: TranscribeProvider;
    generator?: GenerationProvider;
    task?: TaskSubmission['run'];
    queue: ProviderQueue;
    /** 不经模型的任务声明的峰值需求。 */
    resources?: TaskResources;
    /** 本机识别：这个模型包的 Model Worker 加载后约常驻多少、在哪个池（提交时按装好的组件算），估计它的需求；不知道时 null。 */
    workerFootprint?: WorkerFootprint | null;
  } | null;
  /** 排队中的准入请求（准入或终结时为 null）。 */
  ticket: ResourceTicket | null;
  controller: AbortController | null;
  cancelRequested: boolean;
  /** 请求取消的时间（取消的三件事实，§7.4）。 */
  cancelRequestedAt: string | null;
  leased: boolean;
  /** 托管任务的宿主（在途时才有）。 */
  hosted: HostedJobControl | null;
  settled: Promise<JobState>;
  settle: (state: JobState) => void;
  /**
   * 转录这一次尝试到目前为止识别出的段落（架构设计 §6.6「实时文稿」），秒；只在 `running` 时有内容，离开 `running` 就清空。
   * 不落盘：重启后的任务从头重跑（staging 每次尝试都清掉），段落随之从头再来。
   */
  liveSegments: JobLiveSegment[];
}

/** 已配对节点的 `providerId` 前缀：`node:<nodeId>`。 */
const NODE_PREFIX = 'node:';
/** 在线 Provider 的拒绝：适配器给出的错误码，认不出的归为 `PROVIDER_REJECTED`。 */
const PROVIDER_REJECTION_CODES = new Set(['PROVIDER_AUTH_FAILED', 'PROVIDER_QUOTA_EXCEEDED', 'PROVIDER_REJECTED', 'INPUT_TOO_LONG']);
/** 生成输出的格式 → 媒体类型与产物扩展名。 */
const GENERATED_MEDIA: Record<string, { mediaType: string; extension: ArtifactExtension }> = {
  mp3: { mediaType: 'audio/mpeg', extension: 'mp3' },
  wav: { mediaType: 'audio/wav', extension: 'wav' },
  flac: { mediaType: 'audio/flac', extension: 'flac' },
  png: { mediaType: 'image/png', extension: 'png' },
  jpeg: { mediaType: 'image/jpeg', extension: 'jpg' },
  webp: { mediaType: 'image/webp', extension: 'webp' },
};
const NO_INPUT: Entry['input'] = { file: '', mediaType: null, track: 0, hint: null, range: null, timescale: DEFAULT_TIMESCALE };

export class JobManager {
  readonly #options: JobManagerOptions;
  readonly #catalog: ModelCatalog;
  readonly #videos: JobVideos;
  readonly #log: JobsLogger;
  readonly #ledger: JobLedger;
  readonly #artifacts: ArtifactStore;
  readonly #router: TranscribeRouter;
  readonly #entries = new Map<Id, Entry>();
  readonly #resources: ResourceScheduler;
  /** 正在执行的任务（拿着租约）。 */
  readonly #running = new Set<Promise<void>>();
  readonly #listeners = new Set<(job: JobRecord) => void>();
  readonly #segmentListeners = new Set<(update: LiveSegmentsUpdate) => void>();
  readonly #pruneListeners = new Set<(evicted: ReadonlySet<Id>) => void>();
  readonly #maxRetained: number;
  readonly #maxRetainedRetryable: number;
  readonly #probe: MediaProbe;
  readonly #applications: ApplicationLedger;
  readonly #runner: ApplicationRunner;
  /** 启动时判定、要等 `recover()` 处理的任务（重新排队、补做应用、查询远端）。 */
  readonly #awaitingRecovery = new Map<Id, RecoveryAction>();
  /** 正在对账的任务：同一个任务的两次 `jobs.reconcile` 不并行。 */
  readonly #reconciling = new Set<Id>();
  #recovering: Promise<void> | null = null;
  #closing = false;
  /** 故障注入模拟了崩溃：之后什么都不落盘。 */
  #crashed = false;

  constructor(options: JobManagerOptions) {
    this.#options = options;
    this.#catalog = options.catalog;
    this.#videos = options.videos;
    this.#log = options.log ?? silentLog;
    this.#ledger = new JobLedger(options.paths.jobsFile, { log: this.#log });
    this.#artifacts = new ArtifactStore(options.paths.artifactsDir);
    this.#router = options.router;
    this.#maxRetained = options.maxRetainedJobs ?? 200;
    this.#maxRetainedRetryable = options.maxRetainedRetryablePipelines ?? 50;
    this.#probe = options.probe ?? unavailableProbe;
    this.#resources = options.resources ?? new ResourceScheduler({ log: this.#log });
    this.#applications = new ApplicationLedger(path.join(path.dirname(options.paths.jobsFile), 'applications.jsonl'), { log: this.#log });
    this.#runner = new ApplicationRunner({
      ledger: this.#applications,
      videos: this.#videos,
      ...(options.faults ? { faults: options.faults } : {}),
    });
  }

  get artifacts(): ArtifactStore {
    return this.#artifacts;
  }

  /**
   * 读账本并按恢复矩阵对账（§7.5，`job-recovery.ts`）：本机任务与没有恢复能力的标为 `interrupted`，结果不明的外发调用
   * 标为 `needs-reconciliation`（预算按保守规则结算）；要重新排队、补做应用、查询远端的留给 `recover()`。
   * 上次没有结算的预留在这里结算；不属于在途任务的 staging 目录删除。
   */
  async open(): Promise<void> {
    const stored = await this.#ledger.load();
    await this.#applications.load();
    const now = nowIso();
    const counts = { interrupted: 0, reconcile: 0, recover: 0 };
    for (const job of stored) {
      // 旧账本（模型服务之前）的记录没有 `modelId`：取模型包。
      job.record.modelId ??= job.record.bundleId ?? '';
      if (job.publishing) await this.#claimPublished(job, now);
      const latest = this.#applications.latest(job.record.jobId)?.record;
      let action = recoveryAction(job, latest, this.#options.remoteTasks);
      // 排队的任务，预留却已经记为开始：上次在开始执行与记下 `running` 之间停下，请求可能已经发出（§7.8）。不重发。
      const grant = job.record.grant;
      if (action.kind === 'requeue' && grant && !grant.settled && this.#options.admission?.begun?.(grant)) action = { kind: 'reconcile' };
      if (action.kind === 'interrupt') {
        counts.interrupted++;
        Object.assign(job.record, {
          state: 'interrupted',
          phase: 'done',
          endedAt: now,
          updatedAt: now,
          error: stoppedError(),
        } satisfies Partial<JobRecord>);
      } else if (action.kind === 'reconcile') {
        counts.reconcile++;
        Object.assign(job.record, {
          state: 'needs-reconciliation',
          phase: 'done',
          endedAt: now,
          updatedAt: now,
          error: reconciliationError(),
        } satisfies Partial<JobRecord>);
      } else if (action.kind !== 'keep') {
        counts.recover++;
        this.#awaitingRecovery.set(job.record.jobId, action);
      }
      // 上次没有结算的预留（§7.8）：重新排队的还没开始，释放（排队时重新准入）；已经拿到结果、等补做应用的按完成结算；
      // 其余按开始与否结算（开始了的保守扣除）。
      if (job.record.grant && !job.record.grant.settled && this.#options.admission) {
        const state = action.kind === 'resume-application' ? 'completed' : action.kind === 'requeue' ? 'interrupted' : job.record.state;
        job.record.grant = this.#options.admission.settle(job.record.grant, {
          state: state === 'running' ? 'needs-reconciliation' : state,
        });
      }
      this.#project(job);
      const spec = job.spec;
      const input = isTranscribeSpec(spec) ? { ...NO_INPUT, track: spec.track, hint: spec.hint, range: spec.range } : NO_INPUT;
      const entry = this.#entry(job, input, null, { kind: 'video' }, null);
      // 等恢复的任务还没有终结：`settled` 要等它真正结束。
      this.#entries.set(job.record.jobId, entry);
    }
    const jobsStaging = path.join(this.#options.paths.stagingDir, 'jobs');
    await fs.mkdir(jobsStaging, { recursive: true });
    for (const name of await fs.readdir(jobsStaging)) {
      const entry = this.#entries.get(name);
      if (entry && !isTerminal(entry.record.state)) continue;
      await fs.rm(path.join(jobsStaging, name), { recursive: true, force: true });
    }
    if (counts.interrupted > 0) this.#log.warn('Unfinished tasks from last run marked interrupted', { count: counts.interrupted });
    if (counts.reconcile > 0) this.#log.warn('Outgoing calls from last run have unknown results; awaiting reconciliation', { count: counts.reconcile });
    await this.#save();
  }

  /**
   * 认领上次发布到一半的产物（§7.3「产物已发布、应用未结束」）：发布意图在写产物之前落账，记着产物 ID 与结果。
   * 产物都在、内容与摘要相符时，结果记回任务：有视频的补一条 `pending` 的应用（恢复矩阵随之补做应用，预算按完成结算一次），
   * 没有视频的直接完成。不重新推理、不重发请求。有产物不在或对不上时丢掉意图，按原来的矩阵处理。
   */
  async #claimPublished(job: StoredJob, now: string): Promise<void> {
    const intent = job.publishing!;
    delete job.publishing;
    const record = job.record;
    if (isTerminal(record.state)) return;
    const latest = this.#applications.latest(record.jobId);
    if (latest && applicationOpen(latest.record.state)) {
      // 应用已经建了、任务账本还没记下结果：补上结果，应用照常补做。
      record.result ??= intent.result;
      record.warnings = intent.warnings;
      return;
    }
    const present = await Promise.all(intent.artifactIds.map((artifactId) => this.#artifacts.verify(artifactId)));
    if (!present.every(Boolean)) {
      this.#log.warn('Outputs half-published last run are incomplete; handling by the original matrix', { jobId: record.jobId });
      return;
    }
    Object.assign(record, { result: intent.result, warnings: intent.warnings, updatedAt: now } satisfies Partial<JobRecord>);
    if (intent.targetRefs && record.videoId !== null) {
      record.phase = 'applying';
      await this.#runner.create({
        jobId: record.jobId,
        videoId: record.videoId,
        artifactIds: intent.artifactIds,
        targetRefs: intent.targetRefs,
        place: job.videoPlace ?? null,
      });
    } else {
      Object.assign(record, { state: 'completed', phase: 'done', endedAt: now, error: null } satisfies Partial<JobRecord>);
    }
    this.#log.info('Claiming outputs published last run', { jobId: record.jobId, artifacts: intent.artifactIds.length });
  }

  /**
   * 恢复矩阵里要等 Runtime 其余部分就绪才能做的（§7.5）：重新排队之前校验视频、Provider、授权与预算；已经发布的产物
   * 补做应用（先按记下的 `commandId` 查回执）；查询远端任务。`open()` 之后、授权与模型服务就绪之后调用一次；
   * 返回的 Promise 在都处理完时兑现。智能体提交的任务不补做应用：它的 Run 已经随重启结束（停止屏障）。
   */
  recover(): Promise<void> {
    this.#recovering ??= this.#recover();
    return this.#recovering;
  }

  async #recover(): Promise<void> {
    for (const [jobId, action] of [...this.#awaitingRecovery]) {
      if (this.#closing || this.#crashed) return;
      const entry = this.#entries.get(jobId);
      this.#awaitingRecovery.delete(jobId);
      if (!entry) continue;
      try {
        if (action.kind === 'requeue') await this.#requeue(entry);
        else if (action.kind === 'resume-application') await this.#resumeApplication(entry);
        else if (action.kind === 'query-remote') await this.#queryRemote(entry, action.remoteTaskId);
      } catch (error) {
        if (error instanceof SimulatedCrash) return this.#crash(entry);
        this.#log.error('Recovering task failed', { jobId, action: action.kind, error: String(error) });
        if (!isTerminal(entry.record.state)) await this.#finish(entry, 'failed', { error: jobError('INTERNAL', J.recoverFailed()) });
      }
    }
  }

  onChange(listener: (job: JobRecord) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * 转录任务新识别出的段落（`jobs` 主题的 `job.segments`）。与段落进入快照在同一个同步段里，`from` 是第一段在这个任务
   * 当前尝试的全部段落里的序号。
   */
  onSegments(listener: (update: LiveSegmentsUpdate) => void): () => void {
    this.#segmentListeners.add(listener);
    return () => this.#segmentListeners.delete(listener);
  }

  /** 账本的上限淘汰了任务之后（`evicted` 是被淘汰的顶层任务；子任务一并删了）。产物库的清扫据此再跑一轮。 */
  onPruned(listener: (evicted: ReadonlySet<Id>) => void): () => void {
    this.#pruneListeners.add(listener);
    return () => this.#pruneListeners.delete(listener);
  }

  /**
   * 账本里全部任务（任何状态，含流程的步骤）引用的产物：公开记录（结果、输出、步骤的产出、应用）、冻结的规格与执行参数、
   * 还没清掉的发布意图里出现的每个 `sha256:<hex>`。按文本找，宁多勿少：多留一个文件无害，少留一个就是丢了结果。
   */
  referencedArtifactIds(): Set<string> {
    const ids = new Set<string>();
    for (const entry of this.#entries.values()) {
      collectArtifactIds(
        { record: entry.record, spec: entry.spec, publishing: entry.publishing ?? null, input: entry.input, videoPlace: entry.videoPlace ?? null },
        ids,
      );
    }
    for (const application of this.#applications.all()) collectArtifactIds(application, ids);
    return ids;
  }

  snapshot(): JobsSnapshot {
    const liveSegments: Record<Id, JobLiveSegment[]> = {};
    for (const entry of this.#entries.values()) {
      if (entry.record.state === 'running' && entry.liveSegments.length > 0)
        liveSegments[entry.record.jobId] = entry.liveSegments.map((s) => ({ ...s }));
    }
    return Object.keys(liveSegments).length > 0 ? { jobs: this.list(), liveSegments } : { jobs: this.list() };
  }

  list(videoId?: Id): JobRecord[] {
    return [...this.#entries.values()]
      .filter((e) => videoId === undefined || e.record.videoId === videoId)
      .reverse()
      .map((e) => structuredClone(e.record));
  }

  inspect(jobId: Id): JobRecord {
    const entry = this.#entries.get(jobId);
    if (!entry) throw new RpcError('not-found', J.jobNotFound());
    return structuredClone(entry.record);
  }

  /** 等一个任务终结（测试与诊断用）。 */
  settled(jobId: Id): Promise<JobState> {
    const entry = this.#entries.get(jobId);
    if (!entry) return Promise.reject(new RpcError('not-found', J.jobNotFound()));
    return entry.settled;
  }

  /** 重新启用模型包：清掉加载失败、停用与崩溃计数。 */
  enable(bundleId: string): void {
    if (!this.#catalog.definition(bundleId)) throw new RpcError('not-found', J.noBundle());
    this.#catalog.enable(bundleId);
    for (const provider of this.#router.executors()) provider.enable?.(bundleId);
  }

  // ---- 托管任务（固定流程，§7.9） ----

  /**
   * 登记一个由宿主执行的任务：记录由宿主给出（`state` 一般是 `running`），不排队、不执行。Runtime 正在停止时 `busy`。
   * 给了视频时任务期间持有它的租约。
   */
  host(record: JobRecord, options: { hosted: string; control: HostedJobControl; commandId?: Id | null; leaseVideo?: boolean }): HostedJob {
    if (this.#closing) throw new RpcError('busy', J.runtimeStopping());
    if (this.#entries.has(record.jobId)) throw new RpcError('conflict', J.jobIdExists());
    const entry = this.#entry(
      { record: structuredClone(record), spec: { hosted: options.hosted }, workerVersion: null },
      NO_INPUT,
      options.commandId ?? null,
      { kind: 'video' },
      null,
    );
    entry.hosted = options.control;
    this.#entries.set(record.jobId, entry);
    if (options.leaseVideo && record.videoId) {
      this.#videos.retain(record.videoId);
      entry.leased = true;
    }
    this.#changed(entry, true);
    return this.#handle(entry);
  }

  /**
   * 重新执行一个已经终结的托管任务（流程的重试）：同一个 `jobId` 回到 `running`、`attempt` 加一，清掉错误与结果，
   * 换一个新的 `settled`。还在进行时 `conflict`。
   */
  reopen(jobId: Id, options: { control: HostedJobControl; patch?: Partial<JobRecord>; leaseVideo?: boolean }): HostedJob {
    if (this.#closing) throw new RpcError('busy', J.runtimeStopping());
    const entry = this.#entries.get(jobId);
    if (!entry) throw new RpcError('not-found', J.jobNotFound());
    if (!isHostedSpec(entry.spec)) throw new RpcError('conflict', J.onlyHostedRerun());
    if (!isTerminal(entry.record.state)) throw new RpcError('conflict', J.notEnded());
    let settle!: (state: JobState) => void;
    entry.settled = new Promise<JobState>((resolve) => {
      settle = resolve;
    });
    entry.settle = settle;
    entry.cancelRequested = false;
    entry.hosted = options.control;
    Object.assign(entry.record, {
      state: 'running',
      phase: 'starting',
      attempt: entry.record.attempt + 1,
      endedAt: null,
      error: null,
      result: null,
      ...options.patch,
    } satisfies Partial<JobRecord>);
    if (options.leaseVideo && entry.record.videoId && !entry.leased) {
      this.#videos.retain(entry.record.videoId);
      entry.leased = true;
    }
    this.#changed(entry, true);
    return this.#handle(entry);
  }

  /** 改一个已经终结的托管任务的记录（宿主在启动时对账用），并落盘。 */
  async amend(jobId: Id, patch: Partial<JobRecord>): Promise<void> {
    const entry = this.#entries.get(jobId);
    if (!entry || !isHostedSpec(entry.spec) || !isTerminal(entry.record.state)) return;
    Object.assign(entry.record, patch);
    this.#changed(entry, false);
    await this.#save();
  }

  #handle(entry: Entry): HostedJob {
    return {
      jobId: entry.record.jobId,
      record: () => structuredClone(entry.record),
      update: (patch, options) => {
        if (isTerminal(entry.record.state)) return;
        Object.assign(entry.record, patch);
        // 不再等准入：去掉这个字段，不留 undefined。
        if ('wait' in patch && patch.wait === undefined) delete entry.record.wait;
        this.#changed(entry, options?.persist ?? false);
      },
      finish: async (state, patch = {}) => {
        if (isTerminal(entry.record.state)) return;
        entry.hosted = null;
        await this.#finish(entry, state, patch);
      },
    };
  }

  // ---- 提交 ----

  async submitTranscribe(request: TranscribeRequest, submitter: JobSubmitter, grant?: JobGrantHint): Promise<{ jobId: Id }> {
    if (this.#closing) throw new RpcError('busy', J.runtimeStopping());
    if (request.commandId) {
      const existing = this.#byCommand(request.commandId);
      if (existing) return { jobId: existing };
    }
    // 选择 Provider 与模型（§6.2）。节点的模型包由节点核对（节点协议规范 §9），不看本机的模型目录。
    const selection = await this.#router.selectTranscribe({
      ...(request.provider !== undefined ? { provider: request.provider } : {}),
      ...(request.model !== undefined ? { model: request.model } : {}),
      ...(request.node !== undefined ? { node: request.node } : {}),
      ...(request.bundleId !== undefined ? { bundleId: request.bundleId } : {}),
    });

    const language = normalizeLanguage(request.language);
    const userHint = request.hint?.trim() ? request.hint.trim() : null;
    if (userHint && userHint.length > 1200) throw new RpcError('invalid-request', J.hintTooLong());
    checkTranscribeOptions(selection, { hint: userHint, assertedLanguage: language.mode === 'assert' ? language.tag : null });
    // 术语表在提交时读出并冻结版本；规范写法拼进提示（模型接受提示时）。
    const glossaries = request.glossaries?.length
      ? transcribeGlossaries(this.#options.library, request.glossaries, userHint, selection.model.acceptsHint, submitter)
      : null;
    const hint = glossaries ? glossaries.hint : userHint;
    const track = request.track ?? 0;
    const source = await this.#videos.source(request.videoId, request.assetId, request.revision);
    if (!/^(audio|video)\//.test(source.mediaType)) throw new RpcError('invalid-request', J.onlyAudioVideo());
    // 换用文稿（§6.6）：要换的是这个素材的转写；指纹由调用方（转录流程）在提交时算好，应用前再核对一次。
    const replace = request.replace ? checkReplace(request.replace, request.assetId, this.#videos.state?.(request.videoId) ?? null) : null;

    const spec: TranscribeInputSpec = {
      contentHash: source.contentHash,
      track,
      range: null,
      language,
      providerId: selection.providerId,
      modelId: selection.modelId,
      bundleId: selection.bundleId,
      // 不给时按模型：能区分说话人的（自己区分，或装了「说话人区分」模型包）区分（§6.6）。
      diarize: request.diarize ?? (selection.model.speakers === 'native' || selection.model.speakers === 'pack'),
      hint,
      outputContract: ASR_RESULT_SCHEMA,
    };
    const inputHash = transcribeInputHash(spec);
    const workerFootprint = await this.#workerFootprint(selection.providerId, selection.bundleId);

    // 两次 await 之间可能有同样的提交：去重放在同步段里。
    if (request.commandId) {
      const existing = this.#byCommand(request.commandId);
      if (existing) return { jobId: existing };
    }
    for (const entry of this.#entries.values()) {
      const r = entry.record;
      if (
        (r.state === 'queued' || r.state === 'running') &&
        r.inputHash === inputHash &&
        r.videoId === request.videoId &&
        canonicalJson(r.transcribe?.replace ?? null) === canonicalJson(replace)
      ) {
        return { jobId: r.jobId };
      }
    }

    const jobId = newId('job');
    const grantUse = this.#admit(jobId, 'transcribe', selection, request.videoId, submitter, grant, {});
    const now = nowIso();
    const record: JobRecord = {
      jobId,
      kind: 'transcribe',
      state: 'queued',
      phase: 'queued',
      progress: null,
      videoId: request.videoId,
      assetId: request.assetId,
      assetRevision: source.revision,
      contentHash: source.contentHash,
      providerId: selection.providerId,
      modelId: selection.modelId,
      bundleId: selection.bundleId,
      inputHash,
      submitter,
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      endedAt: null,
      error: null,
      result: null,
      warnings: [],
      // 定下的语言与说话人区分（`diarize` 是生效的值），视频卡上那一行用的模型与参数据此显示（产品设计 §3.2.2）。
      transcribe: { language: spec.language, diarize: spec.diarize, ...(replace ? { replace } : {}) },
      ...(glossaries ? { library: glossaries.use } : {}),
      ...(grantUse ? { grant: grantUse } : {}),
    };
    // 任务进行期间固定用到的版本（结束时解除）。
    if (glossaries) this.#options.library!.pin(record.jobId, glossaries.use.entries);
    const entry = this.#entry(
      { record, spec, workerVersion: null, videoPlace: this.#videos.place?.(request.videoId) ?? null },
      { file: source.file, mediaType: source.mediaType, track, hint, range: null, timescale: DEFAULT_TIMESCALE },
      request.commandId ?? null,
      { kind: 'video' },
      { transcriber: selection.transcriber, queue: selection.queue, workerFootprint },
    );
    this.#entries.set(record.jobId, entry);
    this.#videos.retain(request.videoId);
    entry.leased = true;
    this.#log.info('Transcription task queued', {
      jobId: record.jobId,
      providerId: selection.providerId,
      modelId: selection.modelId,
      source: selection.source,
      videoId: record.videoId,
      assetId: record.assetId,
    });
    this.#enqueue(entry);
    return { jobId: record.jobId };
  }

  /**
   * 没有视频的转写（§7.9）：选择与检查同 `submitTranscribe`，输入是调用方给的文件；完成时发布原始结果
   * （`result.documentId` 为 null），不写任何视频。不做在途去重：每次提交是自己的任务，取消互不影响。
   */
  async submitTranscribeWithoutVideo(
    request: StandaloneTranscribeRequest,
    submitter: JobSubmitter,
    grant?: JobGrantHint,
  ): Promise<{ jobId: Id }> {
    if (this.#closing) throw new RpcError('busy', J.runtimeStopping());
    if (!path.isAbsolute(request.file)) throw new RpcError('invalid-request', J.pathNotAbsolute());
    const selection = await this.#router.selectTranscribe({
      ...(request.provider !== undefined ? { provider: request.provider } : {}),
      ...(request.model !== undefined ? { model: request.model } : {}),
    });
    const language = normalizeLanguage(request.language);
    const hint = request.hint?.trim() ? request.hint.trim() : null;
    if (hint && hint.length > 1200) throw new RpcError('invalid-request', J.hintTooLong());
    checkTranscribeOptions(selection, { hint, assertedLanguage: language.mode === 'assert' ? language.tag : null });
    const track = request.track ?? 0;
    if (!Number.isSafeInteger(track) || track < 0) throw new RpcError('invalid-request', J.trackInvalid());
    const contentHash = `sha256:${await fileSha256(request.file)}`;
    const workerFootprint = await this.#workerFootprint(selection.providerId, selection.bundleId);
    const spec: TranscribeInputSpec = {
      contentHash,
      track,
      range: null,
      language,
      providerId: selection.providerId,
      modelId: selection.modelId,
      bundleId: selection.bundleId,
      diarize: false,
      hint,
      outputContract: ASR_RESULT_SCHEMA,
    };
    if (this.#closing) throw new RpcError('busy', J.runtimeStopping());
    const jobId = newId('job');
    const grantUse = this.#admit(jobId, 'transcribe', selection, null, submitter, grant, {});
    const now = nowIso();
    const record: JobRecord = {
      jobId,
      kind: 'transcribe',
      state: 'queued',
      phase: 'queued',
      progress: null,
      videoId: null,
      assetId: null,
      assetRevision: null,
      contentHash,
      providerId: selection.providerId,
      modelId: selection.modelId,
      bundleId: selection.bundleId,
      inputHash: transcribeInputHash(spec),
      submitter,
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      endedAt: null,
      error: null,
      result: null,
      warnings: [],
      ...(grantUse ? { grant: grantUse } : {}),
    };
    const mediaType = request.mediaType && /^(audio|video)\//.test(request.mediaType) ? request.mediaType : null;
    const entry = this.#entry(
      { record, spec, workerVersion: null },
      { file: request.file, mediaType, track, hint, range: null, timescale: DEFAULT_TIMESCALE },
      null,
      { kind: 'video' },
      { transcriber: selection.transcriber, queue: selection.queue, workerFootprint },
    );
    this.#entries.set(record.jobId, entry);
    this.#log.info('Transcription task queued (no video)', {
      jobId: record.jobId,
      providerId: selection.providerId,
      modelId: selection.modelId,
      source: selection.source,
      submitter: submitter.kind,
    });
    this.#enqueue(entry);
    return { jobId: record.jobId };
  }

  /** 语音合成（§6.6）：文本超过模型上限时在提交时拒绝。 */
  submitSynthesizeSpeech(request: SynthesizeSpeechRequest, submitter: JobSubmitter, grant?: JobGrantHint): Promise<{ jobId: Id }> {
    return this.#submitGeneration(
      'synthesizeSpeech',
      request,
      submitter,
      async (choice) => {
        if (choice.model.local) return this.#freezeLocalSpeech(choice, request, submitter);
        // `library:<id>`：用这个 Provider 上的有效克隆（§5.9）。
        const voice = libraryVoice(this.#options.library, request.voice, choice.providerId, submitter);
        if (!voice) return { parameters: speechParameters(choice, request) };
        return { parameters: speechParameters(choice, { ...request, voice: voice.voiceId }), library: voice.use };
      },
      request.text,
      grant,
      { chars: [...request.text].length },
      readableStem(request.text, 'speech'),
    );
  }

  /**
   * 本地合成的声音在提交时决定并冻结（§6.1、§6.6）：音色库条目直接用它的参考录音（固定版本），请求给出的文件与内置音色的录音
   * 在这里读出摘要；读不出时拒绝。模型不读原文时不带原文。
   */
  async #freezeLocalSpeech(
    choice: GenerationSelection<'synthesizeSpeech'>,
    request: SynthesizeSpeechRequest,
    submitter: JobSubmitter,
  ): Promise<{ parameters: GenerationParameters; library?: JobLibraryUse }> {
    const plan = planLocalVoice(choice, request);
    const withTranscript = choice.model.local?.reference?.acceptsTranscript ?? false;
    let reference: FrozenSpeechReference | null = null;
    let library: JobLibraryUse | undefined;
    if (plan.mode === 'clone' && plan.source === 'library') {
      const voice = localLibraryVoice(this.#options.library, plan.libraryId, withTranscript, submitter);
      reference = voice.reference;
      library = voice.use;
    } else if (plan.mode === 'clone') {
      reference = await freezeReferenceFile({ source: 'file', path: plan.path, transcript: plan.transcript });
    } else {
      const builtin = builtinReferenceFile(choice.model, plan);
      if (builtin) reference = await freezeReferenceFile({ ...builtin, transcript: withTranscript ? builtin.transcript : null });
    }
    return { parameters: speechParameters(choice, request, { plan, reference }), ...(library ? { library } : {}) };
  }

  /** 图片生成（§6.6）。本地生图的 seed 在提交时冻结（没给时抽一个），重试与重新执行出同一张图。 */
  submitGenerateImage(request: GenerateImageRequest, submitter: JobSubmitter, grant?: JobGrantHint): Promise<{ jobId: Id }> {
    return this.#submitGeneration(
      'generateImage',
      request,
      submitter,
      (choice) => {
        const parameters = imageParameters(choice, request);
        return { parameters: choice.providerId === 'local' ? { ...parameters, seed: localImageSeed(parameters.seed) } : parameters };
      },
      request.prompt,
      grant,
      { count: request.count ?? 1 },
      readableStem(request.prompt, 'image'),
    );
  }

  /**
   * 文本生成（§6.1、§6.4）：提交时检查并冻结消息、输出格式（JSON Schema 在这里编译）、输出上限与推理强度。
   * 不导入视频；全文发布为产物（`.txt`，结构化输出是 `.json`）。
   */
  submitGenerateText(request: GenerateTextRequest, submitter: JobSubmitter, grant?: JobGrantHint): Promise<{ jobId: Id }> {
    return this.#submitGeneration(
      'generateText',
      request,
      submitter,
      (selection) => ({
        parameters: textParameters(selection, request, selection.textDefaults ?? { effort: null, concurrency: DEFAULT_TEXT_CONCURRENCY }),
      }),
      canonicalJson({ messages: request.messages, responseFormat: request.responseFormat ?? { type: 'text' } }),
      grant,
      {},
      readableStem(request.messages.findLast((m) => m.role === 'user')?.content ?? '', 'text'),
    );
  }

  async #submitGeneration<C extends GenerationCapability>(
    capability: C,
    request: { provider?: string; model?: string; videoId?: Id; name?: string; saveDir?: string; commandId?: Id },
    submitter: JobSubmitter,
    freeze: (
      selection: GenerationSelection<C>,
    ) =>
      | { parameters: GenerationParameters; library?: JobLibraryUse }
      | Promise<{ parameters: GenerationParameters; library?: JobLibraryUse }>,
    source: string,
    grant: JobGrantHint | undefined,
    quantity: { count?: number; chars?: number },
    saveStem: string,
  ): Promise<{ jobId: Id }> {
    if (this.#closing) throw new RpcError('busy', J.runtimeStopping());
    if (request.commandId) {
      const existing = this.#byCommand(request.commandId);
      if (existing) return { jobId: existing };
    }
    if (!this.#router.selectGeneration) {
      throw capabilityNotConfiguredError(capability, 'unsupported', undefined, 'configure-provider', J.noGeneration());
    }
    // 选择 Provider 与模型（§6.2），按模型的特性检查并冻结参数：之后执行与重试都用这一份。
    const selection = await this.#router.selectGeneration(capability, {
      ...(request.provider !== undefined ? { provider: request.provider } : {}),
      ...(request.model !== undefined ? { model: request.model } : {}),
    });
    const { parameters, library } = await freeze(selection);
    const videoId = request.videoId ?? null;
    if (videoId !== null && this.#videos.videoRevision(videoId) === null) throw new RpcError('not-found', J.videoNotOpen());
    // 保存位置（§7.9）：给了时提交前建好目录、确认能写，不行时不建任务。
    if (request.saveDir !== undefined) await ensureSaveDirectory(request.saveDir);

    const spec: GenerationInputSpec = {
      capability,
      providerId: selection.providerId,
      modelId: selection.modelId,
      parameters,
      videoId,
      name: request.name?.trim() ? request.name.trim() : null,
      ...(request.saveDir !== undefined ? { save: { dir: request.saveDir, stem: saveStem } } : {}),
    };
    // 两次 await 之间可能有同样的提交，也可能开始停止。
    if (request.commandId) {
      const existing = this.#byCommand(request.commandId);
      if (existing) return { jobId: existing };
    }
    if (this.#closing) throw new RpcError('busy', J.runtimeStopping());

    const jobId = newId('job');
    const grantUse = this.#admit(jobId, capability, selection, videoId, submitter, grant, quantity);
    // 本地合成的 candle 模型包按常驻量估计 Model Worker（MLX 的是 null，用固定的需求）。
    const workerFootprint = capability === 'synthesizeSpeech' ? await this.#workerFootprint(selection.providerId, selection.modelId) : null;
    const now = nowIso();
    const record: JobRecord = {
      jobId,
      kind: capability,
      state: 'queued',
      phase: 'queued',
      progress: null,
      videoId,
      assetId: null,
      assetRevision: null,
      contentHash: `sha256:${sha256Hex(source)}`,
      providerId: selection.providerId,
      modelId: selection.modelId,
      // 本地合成与本地生图的模型就是模型包：资源调度按它的 Model Worker 计入（§7.7）。
      bundleId:
        selection.providerId === 'local' && (capability === 'synthesizeSpeech' || capability === 'generateImage')
          ? selection.modelId
          : null,
      inputHash: generationInputHash(spec),
      submitter,
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      endedAt: null,
      error: null,
      result: null,
      warnings: [],
      generation: parameters,
      ...(library ? { library } : {}),
      ...(grantUse ? { grant: grantUse } : {}),
    };
    if (library) this.#options.library!.pin(record.jobId, library.entries);
    const entry = this.#entry(
      { record, spec, workerVersion: null, videoPlace: videoId !== null ? (this.#videos.place?.(videoId) ?? null) : null },
      NO_INPUT,
      request.commandId ?? null,
      { kind: 'video' },
      { generator: selection.generator, queue: selection.queue, workerFootprint },
    );
    this.#entries.set(record.jobId, entry);
    if (videoId !== null) {
      this.#videos.retain(videoId);
      entry.leased = true;
    }
    // 原文与提示词不进日志。
    this.#log.info('Generation task queued', {
      jobId: record.jobId,
      kind: capability,
      providerId: selection.providerId,
      modelId: selection.modelId,
      source: selection.source,
      videoId,
    });
    this.#enqueue(entry);
    return { jobId: record.jobId };
  }

  /** 用这个 `commandId` 提交过的任务（重发的命令先查这里，免得重复做冻结与预检）。 */
  jobForCommand(commandId: Id): Id | null {
    return this.#byCommand(commandId);
  }

  /** 不经模型的任务（导出）：调用方已经冻结输入、做完预检。同一个 `commandId` 返回原来的任务。 */
  submitTask(submission: TaskSubmission, submitter: JobSubmitter): { jobId: Id } {
    if (this.#closing) throw new RpcError('busy', J.runtimeStopping());
    if (submission.commandId) {
      const existing = this.#byCommand(submission.commandId);
      if (existing) return { jobId: existing };
    }
    if (submission.resources) {
      const exceeded = this.#resources.check({ owner: '', label: submission.kind, ...submission.resources });
      if (exceeded) {
        throw new RpcError('conflict', exceeded.message, { code: exceeded.code, dimensions: exceeded.dimensions }, exceeded.messageRef);
      }
    }
    const now = nowIso();
    const record: JobRecord = {
      jobId: newId('job'),
      kind: submission.kind,
      state: 'queued',
      phase: 'queued',
      progress: null,
      videoId: submission.videoId,
      assetId: null,
      assetRevision: null,
      contentHash: submission.contentHash,
      providerId: submission.providerId,
      modelId: submission.modelId,
      bundleId: submission.bundleId ?? null,
      inputHash: submission.inputHash,
      submitter,
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      endedAt: null,
      error: null,
      result: null,
      warnings: [],
      ...submission.extra,
    };
    const entry = this.#entry(
      { record, spec: submission.spec, workerVersion: null },
      NO_INPUT,
      submission.commandId ?? null,
      { kind: 'video' },
      { task: submission.run, queue: submission.queue, ...(submission.resources ? { resources: submission.resources } : {}) },
    );
    this.#entries.set(record.jobId, entry);
    this.#log.info('Task queued', { jobId: record.jobId, kind: record.kind, videoId: record.videoId });
    this.#enqueue(entry);
    return { jobId: record.jobId };
  }

  /**
   * 文件目标的转写（远端任务，§6.7）：调用方已经核对过输入文件的摘要。与视频任务排同一个模型包队列；
   * 不做在途去重（幂等由调用方负责）。只用本机（`local`），不经 §6.2 的选择；模型包不可用时抛 `conflict`（`MODEL_UNAVAILABLE`）。
   */
  async submitFile(request: FileTranscribeRequest, submitter: JobSubmitter, observer: FileJobObserver = {}): Promise<{ jobId: Id }> {
    if (this.#closing) throw new RpcError('busy', J.runtimeStopping());
    if (request.jobId !== undefined && this.#entries.has(request.jobId)) throw new RpcError('conflict', J.jobIdExists());
    if (!path.isAbsolute(request.file) || !path.isAbsolute(request.resultFile)) throw new RpcError('invalid-request', J.pathNotAbsolute());
    if (!/^sha256:[0-9a-f]{64}$/.test(request.contentHash)) throw new RpcError('invalid-request', J.contentHashInvalid());
    const provider = await this.#usableProvider(request.bundleId);
    const language = normalizeLanguage(request.language);
    const hint = request.hint?.trim() ? request.hint.trim() : null;
    if (hint && hint.length > 1200) throw new RpcError('invalid-request', J.hintTooLong());
    const timescale = request.timescale ?? DEFAULT_TIMESCALE;
    if (!Number.isSafeInteger(timescale) || timescale <= 0) throw new RpcError('invalid-request', J.timescaleInvalid());
    const range = request.range ? { start: request.range.start, end: request.range.end, timescale } : null;
    if (range && !(Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) && 0 <= range.start && range.start < range.end)) {
      throw new RpcError('invalid-request', J.rangeInvalid());
    }
    const track = request.track ?? 0;
    const diarize = request.diarize ?? false;
    const spec: TranscribeInputSpec = {
      contentHash: request.contentHash,
      track,
      range,
      language,
      providerId: 'local',
      modelId: request.bundleId,
      bundleId: request.bundleId,
      diarize,
      hint,
      outputContract: ASR_RESULT_SCHEMA,
    };
    const workerFootprint = await this.#workerFootprint('local', request.bundleId);
    const jobId = request.jobId ?? newId('job');
    // 两次 await 之间可能有同一个 ID 的提交，也可能开始停止。
    if (this.#entries.has(jobId)) throw new RpcError('conflict', J.jobIdExists());
    if (this.#closing) throw new RpcError('busy', J.runtimeStopping());
    const now = nowIso();
    const record: JobRecord = {
      jobId,
      kind: 'transcribe',
      state: 'queued',
      phase: 'queued',
      progress: null,
      videoId: null,
      assetId: null,
      assetRevision: null,
      contentHash: request.contentHash,
      providerId: 'local',
      modelId: request.bundleId,
      bundleId: request.bundleId,
      inputHash: transcribeInputHash(spec),
      submitter,
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      endedAt: null,
      error: null,
      result: null,
      warnings: [],
    };
    const entry = this.#entry(
      { record, spec, workerVersion: null },
      { file: request.file, mediaType: null, track, hint, range, timescale },
      null,
      {
        kind: 'file',
        resultFile: request.resultFile,
        observer,
      },
      { transcriber: provider, queue: { key: request.bundleId, concurrency: 1 }, workerFootprint },
    );
    this.#entries.set(jobId, entry);
    this.#log.info('Remote transcription task queued', { jobId, bundleId: request.bundleId, submitter: submitter.kind });
    this.#enqueue(entry);
    return { jobId };
  }

  /** 模型包存在、能转写、此刻可用，返回执行它的 Provider。 */
  async #usableProvider(bundleId: string): Promise<TranscribeProvider> {
    const def = this.#catalog.definition(bundleId);
    if (!def) throw new RpcError('not-found', J.noBundleId({ bundleId }));
    if (def.capability !== 'transcribe') throw new RpcError('invalid-request', J.bundleCannotTranscribe());
    const status = await this.#catalog.status(bundleId);
    if (!status || !bundleUsable(status)) {
      throw new RpcError('conflict', J.bundleUnavailable(), { code: 'MODEL_UNAVAILABLE', bundle: status });
    }
    const provider = this.#router.transcriber('local');
    if (!provider) throw new RpcError('conflict', J.localInferenceUnavailable(), { code: 'MODEL_UNAVAILABLE', bundle: status });
    return provider;
  }

  /**
   * 队列由 Provider 给出：本机按模型包（视频任务与节点代别人执行的任务同一个队列，按进入 `queued` 的先后），
   * 远端节点按节点，在线 Provider 按 Provider（各自的并发上限）。
   *
   * 进入 `queued` 的那一条记录在调度看过一遍之后才发：要排队的任务第一条就带着 `wait`，马上准入的第一条不带，
   * 订阅者不会先看到一条不带 `wait` 的 `queued`、紧接着又变成在等。
   */
  #enqueue(entry: Entry): void {
    let announced = false;
    const announce = () => {
      if (announced) return;
      announced = true;
      this.#changed(entry, true);
    };
    if (this.#closing) return announce();
    const record = entry.record;
    entry.ticket = this.#resources.request(this.#resourceRequest(entry), {
      admit: (lease) => {
        announce();
        this.#admitted(entry, lease);
      },
      reject: (error) => {
        announce();
        entry.ticket = null;
        void this.#finish(entry, 'failed', { error: exceededError(error) });
      },
      wait: (wait) => {
        if (record.state !== 'queued') return;
        if (wait) record.wait = wait;
        else delete record.wait;
        if (announced) this.#changed(entry, false);
      },
    });
    announce();
  }

  /**
   * 准入请求：队列来自 Provider；本机转写与本地合成还要这个模型包的 Model Worker（共用的 holder），导出等任务用它们声明的需求。
   */
  #resourceRequest(entry: Entry): ResourceRequest {
    const record = entry.record;
    const executor = entry.executor!;
    const base: ResourceRequest = { owner: record.jobId, label: record.kind, queue: executor.queue };
    if (executor.resources) return { ...base, ...executor.resources };
    if (executor.generator && record.kind === 'generateImage' && record.providerId === 'local' && record.bundleId) {
      // 本地生图按模型包登记的实测峰值（candle 按 Worker 报告的设备取值与池）。
      return { ...base, ...localImageResources(record.bundleId, this.#catalog.imagePeak(record.bundleId)) };
    }
    const localModel = executor.transcriber || (executor.generator && record.kind === 'synthesizeSpeech');
    if (localModel && record.providerId === 'local' && record.bundleId) {
      // 识别与 candle 的本地合成按提交时算好的常驻量估计；MLX 的本地合成用固定的需求。
      return { ...base, ...localTranscribeResources(record.bundleId, executor.workerFootprint ?? null) };
    }
    return base;
  }

  /** 本机识别与合成的模型包加载后约常驻多少（`ModelCatalog.workerFootprint`）；不是本机的模型包时 null。 */
  #workerFootprint(providerId: string, bundleId: string | null): Promise<WorkerFootprint | null> {
    return providerId === 'local' && bundleId ? this.#catalog.workerFootprint(bundleId) : Promise.resolve(null);
  }

  /** 拿到租约：开始执行，执行（含 Provider 停下）结束后归还。 */
  #admitted(entry: Entry, lease: ResourceLease): void {
    entry.ticket = null;
    if (this.#closing || entry.record.state !== 'queued') return lease.release();
    delete entry.record.wait;
    const run: Promise<void> = this.#execute(entry)
      .catch((error: unknown) => {
        if (error instanceof SimulatedCrash) return this.#crash(entry);
        this.#log.error('Task execution failed', { jobId: entry.record.jobId, error: String(error) });
        return this.#finish(entry, 'failed', { error: jobError('INTERNAL', J.executeFailed()) });
      })
      .finally(() => {
        this.#running.delete(run);
        lease.release();
      });
    this.#running.add(run);
  }

  /** 资源调度（`jobs.resources` 与固定流程的步骤用）。 */
  get resources(): ResourceScheduler {
    return this.#resources;
  }

  // ---- 取消与停止 ----

  /**
   * 取消一项计算（§7.4）。排队中的立即取消；运行中的等 Provider 停下（本地 Provider 最多约 5 秒）；结果已经拿到、
   * 还没有提交到视频的，不再提交（停止屏障），结果保留为候选。取消的三件事实记在 `cancellation`。
   */
  async cancel(jobId: Id): Promise<{ state: JobState }> {
    const entry = this.#entries.get(jobId);
    if (!entry) throw new RpcError('not-found', J.jobNotFound());
    const state = entry.record.state;
    if (isTerminal(state)) return { state };
    const barrier = this.#requestCancel(entry);
    const [settled] = await Promise.all([entry.settled, barrier]);
    return { state: settled };
  }

  /**
   * 主停止用的取消（§7.4）：发出取消，只等引擎侧的停止屏障被确认，不等 Provider 停下。兑现之后到达引擎的这个任务的
   * 提交都会被拒；兑现 false 时（没有视频、引擎不在）只有 Node 侧的屏障。
   */
  cancelWrites(jobId: Id): Promise<boolean> {
    const entry = this.#entries.get(jobId);
    if (!entry || isTerminal(entry.record.state)) return Promise.resolve(false);
    return this.#requestCancel(entry);
  }

  /** 记下取消并发出：屏障在任何 await 之前同步发给引擎。返回屏障的确认。 */
  #requestCancel(entry: Entry): Promise<boolean> {
    const state = entry.record.state;
    entry.cancelRequested = true;
    entry.cancelRequestedAt ??= nowIso();
    if (state === 'queued' && !entry.hosted) {
      // 排队的还没有写入，不用引擎侧的屏障；终态落盘的失败交给调用方。
      const cancellation = cancellationFacts(entry.record, 'queued', entry.cancelRequestedAt);
      return this.#finish(entry, 'cancelled', { cancellation }).then(() => false);
    }
    // 引擎侧的停止屏障：之后才到引擎的这一执行的提交都被拒。
    const barrier = this.#invalidate(entry);
    if (entry.hosted) entry.hosted.cancel();
    else entry.controller?.abort();
    return barrier;
  }

  /**
   * 这个任务的执行（§7.4）：Task/Run 还没有实现，任务就是它自己的执行，`runGeneration` 是它的 `attempt`（重试换代）；
   * 固定流程的步骤属于父任务的执行（与 `PipelineStepContext.run` 一致）。
   */
  #runOf(entry: Entry): ApplicationRun {
    const parentId = entry.record.parentJobId;
    const owner = (parentId != null ? this.#entries.get(parentId) : undefined) ?? entry;
    return { runId: owner.record.jobId, runGeneration: String(owner.record.attempt) };
  }

  /** 让引擎拒绝这个任务这一代之后到达的提交。同步发出；没有视频或引擎不支持时兑现 false。 */
  #invalidate(entry: Entry): Promise<boolean> {
    const videoId = entry.record.videoId;
    if (videoId === null || !this.#videos.invalidateRun) return Promise.resolve(false);
    return this.#videos.invalidateRun(videoId, this.#runOf(entry)).catch(() => false);
  }

  /** 正常停止（架构设计 §2.4）：拒绝新任务，中止在途任务并标为 `interrupted`，关闭 Provider 的进程。 */
  async shutdown(): Promise<void> {
    if (this.#closing) return;
    this.#closing = true;
    await this.#recovering?.catch(() => {});
    const pending: Promise<unknown>[] = [];
    for (const entry of this.#entries.values()) {
      // 还没轮到恢复的任务原样留在账本里，下次启动再处理。
      if (this.#awaitingRecovery.has(entry.record.jobId)) continue;
      if (entry.hosted && !isTerminal(entry.record.state)) {
        entry.hosted.interrupt();
        pending.push(entry.settled);
      } else if (entry.record.state === 'queued') pending.push(this.#finish(entry, 'interrupted', { error: stoppedError() }));
      else if (entry.record.state === 'running') {
        entry.controller?.abort();
        pending.push(entry.settled);
      }
    }
    await Promise.allSettled(pending);
    await Promise.allSettled([...this.#running]);
    await Promise.allSettled([
      ...this.#router.executors().map((p) => p.close()),
      ...(this.#router.generators?.() ?? []).map((g) => g.close()),
    ]);
    await this.#ledger.flush();
    await this.#applications.flush();
  }

  // ---- 恢复与对账（§7.5） ----

  /**
   * 处理一个重启后结果不明、没有应用完或被中断的任务（`jobs.reconcile`，决定与合法的状态见 `job-reconcile.ts`）。
   * 不合法时 `conflict`（`RECONCILE_NOT_ALLOWED`）。返回处理之后的记录。
   */
  async reconcile(jobId: Id, decision: JobReconcileDecision): Promise<JobRecord> {
    if (this.#closing) throw new RpcError('busy', J.runtimeStopping());
    const entry = this.#entries.get(jobId);
    if (!entry) throw new RpcError('not-found', J.jobNotFound());
    if (this.#reconciling.has(jobId) || this.#awaitingRecovery.has(jobId)) {
      throw new RpcError('conflict', J.jobReconciling(), { code: 'RECONCILE_NOT_ALLOWED', state: entry.record.state, allowed: [] });
    }
    const latest = this.#applications.latest(jobId);
    const allowed = reconcileChoices(entry, latest?.record);
    if (!allowed.includes(decision)) throw reconcileNotAllowed(entry, decision, allowed);
    this.#reconciling.add(jobId);
    try {
      if (decision === 'retry') await this.#retry(entry);
      else if (decision === 'discard') await this.#discard(entry);
      else await this.#reapply(entry, latest!);
    } finally {
      this.#reconciling.delete(jobId);
    }
    this.#log.info('Task reconciled', { jobId, decision, state: entry.record.state });
    return structuredClone(entry.record);
  }

  /** `retry`：同一个任务回到 `queued`、`attempt` 加一，重新准入。视频要已经打开（不替用户打开）。 */
  async #retry(entry: Entry): Promise<void> {
    const record = entry.record;
    if (record.videoId !== null && this.#videos.videoRevision(record.videoId) === null) {
      throw new RpcError('not-found', J.openVideoToRetry(), { code: 'VIDEO_NOT_OPEN' });
    }
    const prepared = await this.#prepare(entry);
    if (record.videoId !== null) {
      this.#videos.retain(record.videoId);
      entry.leased = true;
    }
    this.#restart(entry, prepared);
  }

  /** `discard`：放弃一个结果不明的外发调用。按保守规则扣下的预算不退。 */
  async #discard(entry: Entry): Promise<void> {
    const record = entry.record;
    const now = nowIso();
    Object.assign(record, {
      state: 'cancelled',
      error: null,
      endedAt: now,
      cancellation: cancellationFacts(record, 'unknown', now, { now }),
    } satisfies Partial<JobRecord>);
    this.#changed(entry, false);
    await this.#save();
  }

  /** `apply`：先按旧的 `commandId` 查回执（可能其实提交了），再新建一次应用、重新校验后提交。视频要已经打开。 */
  async #reapply(entry: Entry, latest: StoredApplication): Promise<void> {
    const videoId = entry.record.videoId!;
    if (this.#videos.videoRevision(videoId) === null) {
      throw new RpcError('not-found', J.openVideoToApply(), { code: 'VIDEO_NOT_OPEN' });
    }
    this.#videos.retain(videoId);
    entry.leased = true;
    try {
      // 查不了回执就不知道上次有没有提交：不换命令重写，留给下次再对账。
      const found = await this.#runner.lookup(latest).catch((error: unknown) => {
        throw new RpcError('busy', J.receiptUnknownLater(), {
          code: 'RECEIPT_UNKNOWN',
          cause: error instanceof Error ? error.message : String(error),
        });
      });
      if (found) return await this.#concludeApplication(entry, await this.#runner.commit(latest, found));
      const item = await this.#runner.create({
        jobId: entry.record.jobId,
        videoId,
        artifactIds: latest.record.artifactIds,
        targetRefs: latest.record.targetRefs,
        place: this.#videos.place?.(videoId) ?? latest.place,
      });
      this.#project(entry);
      await this.#save();
      const app = await this.#runApplication(entry, item, this.#targetFor(entry, item), () => false);
      await this.#concludeApplication(entry, app);
    } finally {
      if (entry.leased) {
        entry.leased = false;
        this.#videos.release(videoId);
      }
    }
  }

  /** 重启时没有被领取的任务：重新校验（视频与素材、Provider、授权与预算）之后排队；校验不过时失败。 */
  async #requeue(entry: Entry): Promise<void> {
    const record = entry.record;
    try {
      if (record.videoId !== null) {
        await this.#retainVideo(record.videoId, entry.videoPlace ?? null);
        entry.leased = true;
      }
      const prepared = await this.#prepare(entry);
      this.#log.info('Re-queuing task queued last run', { jobId: record.jobId, kind: record.kind });
      this.#restart(entry, { ...prepared, attempt: record.attempt });
    } catch (error) {
      if (error instanceof SimulatedCrash) throw error;
      // 输入不在了是失败；Provider、授权或预算此刻不成立是中断（之后可以 `jobs.reconcile retry`）。
      if (error instanceof StaleInput) {
        await this.#finish(entry, 'failed', {
          error: jobError('STALE_JOB_INPUT', withCause(J.requeueCheckFailed(), error)),
        });
      } else {
        await this.#finish(entry, 'interrupted', { error: rpcJobError(error, J.requeueCheckFailed(), 'JOB_INTERRUPTED') });
      }
    }
  }

  /**
   * 重新执行之前的准备：重新选择 Provider（冻结的 Provider 与模型）、读素材并核对内容、重新准入。
   * 不改记录；不通过时抛出（`StaleInput` 或 `RpcError`）。
   */
  async #prepare(entry: Entry): Promise<Prepared> {
    const record = entry.record;
    const spec = entry.spec;
    const choice = { provider: record.providerId, model: record.modelId };
    const hint = record.grant ? { grantId: record.grant.grantId, dataKinds: record.grant.dataKinds } : undefined;
    if (isTranscribeSpec(spec)) {
      const source = await this.#videos
        .source(record.videoId!, record.assetId!, record.assetRevision ?? undefined)
        .catch((error: unknown) => {
          throw error instanceof RpcError && error.code === 'not-found' ? new StaleInput(J.assetVersionGone()) : error;
        });
      if (source.contentHash !== record.contentHash) throw new StaleInput(J.assetChanged());
      const selection = await this.#router.selectTranscribe(choice);
      const grant = this.#admit(record.jobId, 'transcribe', selection, record.videoId, record.submitter, hint, {});
      const workerFootprint = await this.#workerFootprint(selection.providerId, selection.bundleId);
      return {
        input: {
          file: source.file,
          mediaType: source.mediaType,
          track: spec.track,
          hint: spec.hint,
          range: spec.range,
          timescale: DEFAULT_TIMESCALE,
        },
        executor: { transcriber: selection.transcriber, queue: selection.queue, workerFootprint },
        grant: grant ?? null,
      };
    }
    if (!('capability' in spec) || !this.#router.selectGeneration) throw new RpcError('conflict', J.cannotRerun());
    const selection = await this.#router.selectGeneration(spec.capability, choice);
    const parameters = spec.parameters;
    const quantity =
      parameters.capability === 'synthesizeSpeech'
        ? { chars: [...parameters.text].length }
        : parameters.capability === 'generateImage'
          ? { count: parameters.count }
          : {};
    const grant = this.#admit(record.jobId, spec.capability, selection, record.videoId, record.submitter, hint, quantity);
    const workerFootprint =
      spec.capability === 'synthesizeSpeech' ? await this.#workerFootprint(selection.providerId, selection.modelId) : null;
    return { input: NO_INPUT, executor: { generator: selection.generator, queue: selection.queue, workerFootprint }, grant: grant ?? null };
  }

  /** 让一个准备好的任务回到 `queued`：换一个新的 `settled`，旧的结算记进 `grant.retries`。 */
  #restart(entry: Entry, prepared: Prepared & { attempt?: number }): void {
    const record = entry.record;
    const previous = record.grant;
    let settle!: (state: JobState) => void;
    entry.settled = new Promise<JobState>((resolve) => {
      settle = resolve;
    });
    entry.settle = settle;
    entry.cancelRequested = false;
    entry.cancelRequestedAt = null;
    entry.input = prepared.input;
    entry.executor = prepared.executor;
    if (record.library) {
      try {
        this.#options.library?.pin(record.jobId, record.library.entries);
      } catch (error) {
        this.#log.warn('Could not pin library versions on re-run', { jobId: record.jobId, error: String(error) });
      }
    }
    delete record.cancellation;
    Object.assign(record, {
      state: 'queued',
      phase: 'queued',
      progress: null,
      attempt: prepared.attempt ?? record.attempt + 1,
      startedAt: null,
      endedAt: null,
      error: null,
      result: null,
    } satisfies Partial<JobRecord>);
    if (prepared.grant) {
      const history = [...(previous?.retries ?? []), ...(previous?.settled ? [previous.settled] : [])];
      record.grant = { ...prepared.grant, ...(history.length > 0 ? { retries: history } : {}) };
    } else if (previous) {
      delete record.grant;
    }
    this.#enqueue(entry);
  }

  /** 重启后补做应用：先按记下的 `commandId` 查回执；没有提交过才重新校验并应用（智能体提交的不再自动应用）。 */
  async #resumeApplication(entry: Entry): Promise<void> {
    const item = this.#applications.latest(entry.record.jobId)!;
    const videoId = item.record.videoId;
    try {
      await this.#retainVideo(videoId, item.place);
      entry.leased = true;
    } catch (error) {
      const app =
        error instanceof StaleInput
          ? await this.#runner.end(item, 'stale-input', jobError('STALE_JOB_INPUT', errorText(error)))
          : await this.#runner.end(item, 'rejected', rpcJobError(error, J.cannotOpenVideoAfterRestart(), 'APPLY_FAILED'));
      return this.#concludeApplication(entry, app);
    }
    let found: AppliedReceipt | null;
    try {
      found = await this.#runner.lookup(item);
    } catch (error) {
      // 查不了回执：不知道上次有没有提交，不能换命令重写。留给用户（`jobs.reconcile apply` 会先再查一次）。
      const app = await this.#runner.end(item, 'rejected', rpcJobError(error, J.receiptUnknown(), 'RECEIPT_UNKNOWN', true));
      return this.#concludeApplication(entry, app);
    }
    if (found) {
      this.#log.info('Last application was committed; recording its receipt', { jobId: entry.record.jobId, applicationId: item.record.applicationId });
      return this.#concludeApplication(entry, await this.#runner.commit(item, found));
    }
    const agent = entry.record.submitter.kind === 'agent';
    const stopped = () => agent || entry.cancelRequested;
    const app = await this.#runApplication(entry, item, this.#targetFor(entry, item), stopped, this.#runOf(entry));
    return this.#concludeApplication(entry, app);
  }

  /** 查询远端任务（§7.5）。查到还在跑或已经成功时怎样取回结果没有定义：一律等用户对账，从不重新提交。 */
  async #queryRemote(entry: Entry, remoteTaskId: string): Promise<void> {
    const record = entry.record;
    const status = await this.#options
      .remoteTasks!.query({ jobId: record.jobId, providerId: record.providerId, modelId: record.modelId, remoteTaskId })
      .catch(() => null);
    if (status?.status === 'failed') {
      return this.#finish(entry, 'failed', { error: { code: 'PROVIDER_REJECTED', message: status.message, details: { remoteTaskId } } });
    }
    if (status?.status === 'not-found') return this.#finish(entry, 'interrupted', { error: stoppedError() });
    return this.#finish(entry, 'needs-reconciliation', {
      error: { ...reconciliationError(), details: { remoteTaskId, remote: status?.status ?? 'unknown' } },
    });
  }

  /** 让视频保持打开：已经打开时加一个租约；重启后没有打开时按记下的位置重新打开。不成立时抛 `StaleInput`。 */
  async #retainVideo(videoId: Id, place: VideoPlace | null): Promise<void> {
    if (this.#videos.videoRevision(videoId) !== null) {
      this.#videos.retain(videoId);
      return;
    }
    if (!place || !this.#videos.reopen) throw new StaleInput(J.videoNotOpenNoPlace());
    const outcome = await this.#videos.reopen(videoId, place);
    if (outcome === 'missing') throw new StaleInput(J.videoFolderGone());
    if (outcome === 'mismatch') throw new StaleInput(J.videoReplaced());
  }

  /** 任务记录里的应用（投影，权威在应用账本）。 */
  #project(job: StoredJob): void {
    const items = this.#applications.forJob(job.record.jobId);
    if (items.length > 0) job.record.applications = items.map((item) => structuredClone(item.record));
    else delete job.record.applications;
  }

  /** 故障注入模拟了崩溃：冻结两本账，丢下这个任务（不结算、不改记录），像进程没了一样。 */
  #crash(entry: Entry): void {
    this.#crashed = true;
    this.#applications.freeze();
    this.#log.warn('Simulated crash', { jobId: entry.record.jobId });
    entry.controller = null;
    if (entry.leased) {
      entry.leased = false;
      if (entry.record.videoId) this.#videos.release(entry.record.videoId);
    }
    entry.settle(entry.record.state);
  }

  #fault(point: JobFaultPoint, entry: Entry): void {
    if (this.#options.faults?.(point, { jobId: entry.record.jobId }) === 'crash') throw new SimulatedCrash(point);
  }

  // ---- 执行 ----

  async #execute(entry: Entry): Promise<void> {
    if (isHostedSpec(entry.spec)) throw new Error('Hosted tasks are not queued');
    if (isTaskSpec(entry.spec)) return this.#executeTask(entry);
    if (!isTranscribeSpec(entry.spec)) return this.#executeGeneration(entry, entry.spec);
    const spec = entry.spec;
    const record = entry.record;
    const provider = entry.executor?.transcriber;
    if (!provider) return this.#finish(entry, 'failed', { error: jobError('MODEL_LOAD_FAILED', J.providerUnavailable()) });
    const staging = this.#stagingOf(record.jobId);
    for (;;) {
      const refused = await this.#grantStart(entry);
      if (refused) return this.#finish(entry, 'failed', { error: refused });
      const now = nowIso();
      Object.assign(record, { state: 'running', phase: 'starting', progress: null, error: null, startedAt: record.startedAt ?? now });
      // 每次尝试从头识别（staging 清空，不接着上一次的 segments.jsonl），实时段落也从序号 0 重来。
      entry.liveSegments = [];
      this.#changed(entry, true);
      await fs.rm(staging, { recursive: true, force: true });
      await fs.mkdir(staging, { recursive: true });
      const controller = new AbortController();
      entry.controller = controller;
      if (entry.cancelRequested || this.#closing) controller.abort();

      let failure: ProviderFailure;
      try {
        const attempt = await provider.transcribe(
          {
            jobId: record.jobId,
            runGeneration: record.attempt,
            providerId: record.providerId,
            modelId: record.modelId,
            bundleId: record.bundleId,
            input: {
              file: entry.input.file,
              contentHash: record.contentHash,
              track: entry.input.track,
              ...(entry.input.range ? { range: entry.input.range } : {}),
            },
            options: {
              language: spec.language,
              diarize: spec.diarize,
              ...(entry.input.hint ? { hint: entry.input.hint } : {}),
              timescale: entry.input.timescale,
            },
            staging,
            ...(entry.workerVersion ? { expectedWorkerVersion: entry.workerVersion } : {}),
            ...(entry.input.mediaType ? { mediaType: entry.input.mediaType } : {}),
            ...(record.providerId.startsWith(NODE_PREFIX) ? { node: record.providerId.slice(NODE_PREFIX.length) } : {}),
          },
          this.#sink(entry),
          controller.signal,
        );
        entry.controller = null;
        if (attempt.outcome === 'cancelled' && attempt.warnings?.length) record.warnings = [...record.warnings, ...attempt.warnings];
        if (attempt.outcome === 'cancelled' || entry.cancelRequested || this.#closing)
          return this.#stopped(entry, attempt.outcome === 'cancelled');
        entry.workerVersion ??= attempt.workerVersion;
        return await this.#complete(entry, attempt.output, staging, attempt.runGeneration ?? record.attempt);
      } catch (error) {
        entry.controller = null;
        if (entry.cancelRequested || this.#closing) return this.#stopped(entry);
        if (!(error instanceof ProviderFailure)) throw error;
        failure = error;
      }

      const details = failure.details;
      switch (failure.kind) {
        case 'crashed': {
          if (typeof details.workerVersion === 'string') entry.workerVersion ??= details.workerVersion;
          const error = jobError('MODEL_WORKER_CRASHED', errorText(failure), { ...details, attempt: record.attempt });
          if (record.attempt === 1 && (record.bundleId === null || !this.#catalog.blocked(record.bundleId))) {
            // 这一次没有做完：标为中断，同一个模型包、同一个输入、同一个 Worker 版本再试一次（§6.5）。
            this.#log.warn('Model Worker crashed; retrying once', { jobId: record.jobId });
            if (entry.target.kind === 'file') entry.target.observer.retrying?.(record.attempt + 1);
            Object.assign(record, { state: 'interrupted', error });
            this.#changed(entry, true);
            const budget = this.#grantRetry(entry);
            if (budget) return this.#finish(entry, 'failed', { error: budget });
            record.attempt++;
            continue;
          }
          const message = record.providerId === 'local' ? J.localCrashedAfterRetry() : J.transcribeFailedAfterRetry();
          return this.#finish(entry, 'failed', { error: jobError(error.code, message, error.details) });
        }
        default:
          return this.#finish(entry, 'failed', { error: failureError(failure, record.providerId) });
      }
    }
  }

  /** 不经模型的任务的一次执行。正常返回即完成；信号中止后的失败算取消或中断。 */
  async #executeTask(entry: Entry): Promise<void> {
    const record = entry.record;
    const run = entry.executor?.task;
    if (!run) return this.#finish(entry, 'failed', { error: jobError('INTERNAL', J.executorGone()) });
    const staging = this.#stagingOf(record.jobId);
    Object.assign(record, { state: 'running', phase: 'starting', progress: null, error: null, startedAt: record.startedAt ?? nowIso() });
    this.#changed(entry, true);
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });
    const controller = new AbortController();
    entry.controller = controller;
    if (entry.cancelRequested || this.#closing) controller.abort();
    const update = (patch: Partial<JobRecord>) => {
      if (record.state !== 'running') return;
      Object.assign(record, patch);
      this.#changed(entry, false);
    };
    try {
      const result = await run({
        jobId: record.jobId,
        staging,
        signal: controller.signal,
        phase: (phase, progress = null) => update({ phase, progress }),
        warn: (warning) => update({ warnings: [...record.warnings, warning] }),
        command: (command) => update({ command }),
      });
      entry.controller = null;
      return await this.#finish(entry, 'completed', { result });
    } catch (error) {
      entry.controller = null;
      if (controller.signal.aborted) return this.#stopped(entry);
      if (!(error instanceof TaskFailure)) throw error;
      const failed = jobError(error.code, errorText(error), error.details);
      return this.#finish(entry, 'failed', { error: failed, ...(error.result ? { result: error.result } : {}) });
    }
  }

  /** 生成任务的一次执行。在线 Provider 自己有界重试连不上与 5xx；这里不重试，不换模型或声音。 */
  async #executeGeneration(entry: Entry, spec: GenerationInputSpec): Promise<void> {
    const record = entry.record;
    const generator = entry.executor?.generator;
    if (!generator) return this.#finish(entry, 'failed', { error: jobError('MODEL_LOAD_FAILED', J.providerUnavailable()) });
    const refused = await this.#grantStart(entry);
    if (refused) return this.#finish(entry, 'failed', { error: refused });
    const staging = this.#stagingOf(record.jobId);
    Object.assign(record, { state: 'running', phase: 'starting', progress: null, error: null, startedAt: record.startedAt ?? nowIso() });
    this.#changed(entry, true);
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });
    const controller = new AbortController();
    entry.controller = controller;
    if (entry.cancelRequested || this.#closing) controller.abort();
    try {
      const attempt = await generator.generate(
        {
          jobId: record.jobId,
          attempt: record.attempt,
          providerId: record.providerId,
          modelId: record.modelId,
          parameters: spec.parameters,
          staging,
        },
        this.#generationSink(entry),
        controller.signal,
      );
      entry.controller = null;
      if (attempt.outcome === 'cancelled' || entry.cancelRequested || this.#closing)
        return this.#stopped(entry, attempt.outcome === 'cancelled');
      entry.workerVersion ??= attempt.workerVersion;
      return await this.#completeGeneration(entry, spec, attempt.outputs, staging, attempt.text);
    } catch (error) {
      entry.controller = null;
      if (entry.cancelRequested || this.#closing) return this.#stopped(entry);
      if (!(error instanceof ProviderFailure)) throw error;
      return this.#finish(entry, 'failed', { error: failureError(error, record.providerId) });
    }
  }

  #generationSink(entry: Entry): GenerationSink {
    const record = entry.record;
    const update = (patch: Partial<JobRecord>) => {
      if (record.state !== 'running') return;
      Object.assign(record, patch);
      this.#changed(entry, false);
    };
    return {
      generating: () => update({ phase: 'generating' }),
      progress: (done, total, unit = 'outputs') => update({ phase: 'generating', progress: { done, total, unit } }),
      warning: (warning) => update({ warnings: [...record.warnings, warning] }),
    };
  }

  /** 校验（摘要、长度、文件头、ffprobe 解码）→ 发布 → 给了视频时导入为素材（§7.3）。 */
  async #completeGeneration(
    entry: Entry,
    spec: GenerationInputSpec,
    outputs: GenerationOutputFile[],
    staging: string,
    text?: TextResult,
  ): Promise<void> {
    const record = entry.record;
    const parameters = spec.parameters;
    if (parameters.capability === 'generateText') return this.#completeText(entry, parameters, outputs, staging, text);
    this.#phase(entry, 'validating');
    const expected = GENERATED_MEDIA[parameters.format]!;
    const count = parameters.capability === 'generateImage' ? parameters.count : 1;
    const files: string[] = [];
    const checked: Array<{ bytes: Buffer; media: MediaFacts }> = [];
    const problems: string[] = [];
    if (outputs.length !== count) problems.push(J.outputCountMismatch({ actual: outputs.length, expected: count }).text);
    for (const [index, output] of outputs.entries()) {
      const n = index + 1;
      const file = path.resolve(staging, output.path);
      const relative = path.relative(staging, file);
      if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
        problems.push(J.outputNotInStaging({ n }).text);
        continue;
      }
      files.push(file);
      const bytes = await fs.readFile(file).catch(() => null);
      if (!bytes) {
        problems.push(J.outputMissing({ n }).text);
        continue;
      }
      if (bytes.length !== output.byteLength) problems.push(J.outputLengthMismatch({ n, actual: bytes.length, declared: output.byteLength }).text);
      if (sha256Hex(bytes) !== output.sha256.replace(/^sha256:/, '')) problems.push(J.outputShaMismatch({ n }).text);
      if (output.mediaType !== expected.mediaType) problems.push(J.outputTypeMismatch({ n, actual: output.mediaType, expected: expected.mediaType }).text);
      const probed = await this.#probe(file, expected.mediaType);
      if (!probed.ok) {
        problems.push(...probed.problems.map((problem) => J.outputProblem({ n, problem }).text));
        continue;
      }
      checked.push({ bytes, media: probed.media });
    }
    if (problems.length > 0) return this.#rejectGenerated(entry, files, problems);

    this.#phase(entry, 'publishing');
    // 产物 ID 是内容摘要：写之前就知道，先把发布意图落账（§7.3）。
    const published: GeneratedOutput[] = checked.map(({ bytes, media }) => ({
      artifactId: artifactIdOf(bytes),
      mediaType: expected.mediaType,
      byteLength: bytes.length,
      assetId: null,
      media,
    }));
    const result = { documentId: null, artifactId: published[0]!.artifactId, outputs: published };
    const artifactIds = published.map((o) => o.artifactId);
    const targetRefs = record.videoId === null ? null : published.map((_, i) => `output${i + 1}`);
    await this.#publish(entry, { artifactIds, result, targetRefs, warnings: record.warnings }, async () => {
      for (const { bytes } of checked) await this.#artifacts.put(bytes, expected.extension);
    });
    const paths = await this.#saveCopies(entry, spec, published.map((o) => ({ artifactId: o.artifactId, extension: expected.extension })));
    paths.forEach((p, i) => {
      if (p !== null) published[i]!.path = p;
    });
    if (targetRefs === null) return this.#finish(entry, 'completed', { result });
    return this.#applyPublished(entry, result, { artifactIds, targetRefs });
  }

  /**
   * 文本生成的结果：核对路径、摘要与长度，按 UTF-8 解码；结构化输出再解析一次、按冻结的 schema 校验（执行者已经校验过，
   * 这里不信任它）→ 发布为产物 → 结果带产物 ID 与开头一段的预览。因输出上限被截断的纯文本照样完成，带
   * `output-truncated` 警告（§6.4：`length` 不是完整的成功）。
   */
  async #completeText(
    entry: Entry,
    parameters: TextParameters,
    outputs: GenerationOutputFile[],
    staging: string,
    text: TextResult | undefined,
  ): Promise<void> {
    const record = entry.record;
    this.#phase(entry, 'validating');
    const json = parameters.responseFormat.type === 'json';
    const mediaType = json ? 'application/json' : 'text/plain';
    const problems: string[] = [];
    const files: string[] = [];
    let content: string | null = null;
    let bytes: Buffer | null = null;
    if (!text) problems.push(J.noTextResult().text);
    if (outputs.length !== 1) problems.push(J.textOutputCount({ actual: outputs.length }).text);
    const output = outputs[0];
    if (output) {
      const file = path.resolve(staging, output.path);
      const relative = path.relative(staging, file);
      if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
        problems.push(J.textNotInStaging().text);
      } else {
        files.push(file);
        bytes = await fs.readFile(file).catch(() => null);
        if (!bytes) problems.push(J.textMissing().text);
      }
      if (bytes) {
        if (bytes.length !== output.byteLength) problems.push(J.textLengthMismatch({ actual: bytes.length, declared: output.byteLength }).text);
        if (sha256Hex(bytes) !== output.sha256.replace(/^sha256:/, '')) problems.push(J.textShaMismatch().text);
        if (output.mediaType !== mediaType) problems.push(J.textTypeMismatch({ actual: output.mediaType, expected: mediaType }).text);
        try {
          content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          problems.push(J.notUtf8().text);
        }
      }
    }
    if (content !== null && parameters.responseFormat.type === 'json') {
      try {
        problems.push(...compileJsonSchema(parameters.responseFormat.schema).validate(JSON.parse(content)));
      } catch {
        problems.push(J.notJson().text);
      }
    }
    if (content !== null && content.trim().length === 0) problems.push(J.emptyOutput().text);
    if (problems.length > 0 || !text || !bytes || content === null) return this.#rejectGenerated(entry, files, problems);

    this.#phase(entry, 'publishing');
    const artifactId = artifactIdOf(bytes);
    const chars = [...content];
    const summary: TextJobResult = {
      mediaType,
      byteLength: bytes.length,
      length: chars.length,
      preview: chars.slice(0, TEXT_PREVIEW_CHARS).join(''),
      previewTruncated: chars.length > TEXT_PREVIEW_CHARS,
      finishReason: text.finishReason,
      usage: text.usage,
      modelVersion: text.modelVersion,
      notes: text.notes,
    };
    if (text.finishReason === 'length') {
      record.warnings = [
        ...record.warnings,
        jobWarning('output-truncated', J.outputTruncated({ limit: parameters.maxOutputTokens })),
      ];
    }
    const result: NonNullable<JobRecord['result']> = { documentId: null, artifactId, text: summary };
    await this.#publish(entry, { artifactIds: [artifactId], result, targetRefs: null, warnings: record.warnings }, async () => {
      await this.#artifacts.put(bytes, json ? 'json' : 'txt');
    });
    // 保存位置的副本（§7.9）：写成了时结果多一项带 `path` 的文本输出，其余不变。
    const [saved] = await this.#saveCopies(entry, entry.spec as GenerationInputSpec, [{ artifactId, extension: json ? 'json' : 'txt' }]);
    if (saved) {
      result.outputs = [
        { artifactId, mediaType, byteLength: bytes.length, assetId: null, media: { kind: 'text', entries: 0, durationSec: 0 }, path: saved },
      ];
    }
    return this.#finish(entry, 'completed', { result });
  }

  /**
   * 保存位置的副本（架构设计 §7.9「保存位置」）：产物发布之后，在提交时冻结的目录里按可读的名字复制一份（不硬链接进产物库，
   * 用户改动副本不影响产物），同名时加序号、不覆盖。多个输出依次加序号。写不成不算任务失败：那一份没有路径，
   * 结果带 `save-copy-failed` 警告。没有保存位置时全是 null。
   */
  async #saveCopies(
    entry: Entry,
    spec: GenerationInputSpec,
    items: Array<{ artifactId: string; extension: string }>,
  ): Promise<Array<string | null>> {
    const save = spec.save;
    if (!save) return items.map(() => null);
    const record = entry.record;
    const paths: Array<string | null> = [];
    for (const [index, item] of items.entries()) {
      const stem = items.length > 1 ? `${save.stem}-${index + 1}` : save.stem;
      try {
        const source = await this.#artifacts.locate(item.artifactId);
        if (!source) throw new Error('Output not found in the output store');
        await fs.mkdir(save.dir, { recursive: true });
        paths.push(await publishFile(source, save.dir, stem, `.${item.extension}`, record.jobId, false));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.#log.warn('Copy to save location was not written', { jobId: record.jobId, reason });
        record.warnings = [...record.warnings, jobWarning('save-copy-failed', J.saveCopyFailed({ dir: save.dir, reason: errorText(error) }))];
        paths.push(null);
      }
    }
    return paths;
  }

  /** 生成的输出校验不过：不发布，不重试；原始文件移到诊断目录（§6.5）。 */
  async #rejectGenerated(entry: Entry, files: string[], problems: string[]): Promise<void> {
    const record = entry.record;
    const dir = path.join(this.#options.paths.diagnosticsDir, record.jobId);
    await fs.mkdir(dir, { recursive: true });
    for (const file of files) {
      const kept = path.join(dir, path.basename(file));
      await fs.rename(file, kept).catch(() => {});
    }
    await fs.writeFile(path.join(dir, 'job.json'), `${JSON.stringify({ record, problems }, null, 2)}\n`).catch(() => {});
    this.#log.warn('Generated output failed validation', { jobId: record.jobId, problems: problems.slice(0, 5) });
    return this.#finish(entry, 'failed', {
      error: jobError('MODEL_OUTPUT_INVALID', J.generatedInvalid(), { problems }),
    });
  }

  // ---- 应用到视频（§7.1–§7.3） ----

  /**
   * 发布产物（§7.3）：先把发布意图（产物 ID、结果、应用的目标）落账，再写产物库。之间或之后崩溃，重启时按意图认领
   * 已经写好的产物（`#claimPublished`），不重新推理、不重发请求。意图在结果与应用记下（或任务结束）时清掉。
   */
  async #publish(entry: Entry, intent: PublishIntent, write: () => Promise<void>): Promise<void> {
    entry.publishing = structuredClone(intent);
    await this.#save();
    await write();
    this.#fault('artifact-stored', entry);
  }

  /**
   * 产物已经发布：结算预算（按完成，之后应用成不成功都不影响预算），记下结果与一条 `pending` 的应用（等落盘），
   * 再校验并提交。`asr`：刚校验过的转写结果（不再从产物读回）。
   */
  async #applyPublished(
    entry: Entry,
    result: NonNullable<JobRecord['result']>,
    target: { artifactIds: string[]; targetRefs: string[] },
    asr?: AsrResult,
  ): Promise<void> {
    const record = entry.record;
    const videoId = record.videoId!;
    record.result = result;
    if (record.grant && !record.grant.settled && this.#options.admission) {
      record.grant = this.#options.admission.settle(record.grant, { state: 'completed' });
    }
    const item = await this.#runner.create({ jobId: record.jobId, videoId, ...target, place: this.#videos.place?.(videoId) ?? null });
    // 结果与应用都记下了：发布意图随这次写入清掉。
    delete entry.publishing;
    this.#project(entry);
    this.#phase(entry, 'applying');
    await this.#save();
    this.#fault('artifact-published', entry);
    const applyTarget = this.#targetFor(entry, item, asr);
    const app = await this.#runApplication(entry, item, applyTarget, () => entry.cancelRequested, this.#runOf(entry));
    return this.#concludeApplication(entry, app);
  }

  /** 跑一次应用；意外的错误记为 `rejected`（模拟的崩溃照样抛出）。 */
  async #runApplication(
    entry: Entry,
    item: StoredApplication,
    target: ApplicationTarget,
    stopped: () => boolean,
    run?: ApplicationRun,
  ): Promise<ApplicationRecord> {
    try {
      return await this.#runner.run(item, target, stopped, run);
    } catch (error) {
      if (error instanceof SimulatedCrash) throw error;
      this.#log.error('Applying to video failed', { jobId: entry.record.jobId, error: String(error) });
      return this.#runner.end(
        item,
        'rejected',
        jobError('INTERNAL', J.applyError(), { cause: error instanceof Error ? error.message : String(error) }),
      );
    }
  }

  /**
   * 应用要写什么、怎样校验。从记录与产物重建，重启后与第一次完全相同：转写是素材上的一份 `speech` 文档（素材的当前内容
   * 必须仍是这次转写的输入），生成是把全部输出导入为候选素材的一笔事务（视频打开着即可）。
   */
  #targetFor(entry: Entry, item: StoredApplication, asr?: AsrResult): ApplicationTarget {
    const record = entry.record;
    const app = item.record;
    const videoId = app.videoId;
    if (record.kind === 'transcribe') {
      const assetId = record.assetId!;
      const artifactId = app.artifactIds[0]!;
      return {
        label: J.transcribeLabel().text,
        check: () => {
          const current = this.#videos.current(videoId, assetId);
          if (!current) throw new StaleInput(J.videoClosed());
          if (!current.asset) throw new StaleInput(J.assetGone());
          if (current.asset.contentHash !== record.contentHash) throw new StaleInput(J.assetChangedDuringTranscribe());
          return current.videoRevision;
        },
        operations: async () => {
          const result = asr ?? (await this.#readAsrResult(artifactId));
          const replace = record.transcribe?.replace;
          const document = this.#videos.state?.(videoId)?.documents[replace?.documentId ?? ''];
          const operation = speechDocumentOperation(result, {
            assetId,
            jobId: record.jobId,
            providerId: record.providerId,
            inputHash: record.inputHash,
            rawResultArtifactId: artifactId,
            createdAt: app.createdAt,
            // 换用文稿：新词的 ID 与旧文稿的不同（按新版本号起头），没重锚上的换行、分段条目才真的不生效。
            ...(replace && document ? { wordIdPrefix: `w-${nextRevision(document)}-` } : {}),
          });
          if (!replace) return [withAsrStage(operation)];
          const { operations } = await planTranscriptSwitch(this.#videos, { videoId, replace, speech: operation, jobId: record.jobId });
          return operations;
        },
      };
    }
    const spec = entry.spec as GenerationInputSpec;
    return {
      label: (spec.capability === 'synthesizeSpeech' ? J.voiceOverLabel() : J.imageLabel()).text,
      check: () => {
        const revision = this.#videos.videoRevision(videoId);
        if (revision === null) throw new StaleInput(J.videoClosed());
        return revision;
      },
      operations: async () =>
        Promise.all(
          app.artifactIds.map(async (artifactId, index) => {
            const file = await this.#artifacts.locate(artifactId);
            if (!file) throw new StaleInput(J.generatedGone());
            return generatedImportOperation(
              record,
              { artifactId, file, index, total: app.artifactIds.length },
              { name: spec.name, ref: app.targetRefs[index]! },
            );
          }),
        ),
    };
  }

  async #readAsrResult(artifactId: string): Promise<AsrResult> {
    const bytes = await this.#artifacts.read(artifactId);
    if (!bytes) throw new StaleInput(J.asrGone());
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new StaleInput(J.asrNotJson());
    }
    const validation = validateAsrResult(parsed);
    if (!validation.ok) throw new StaleInput(J.asrInvalid());
    return validation.result;
  }

  /**
   * 应用结束之后任务的状态：提交了是 `completed`（结果里补上文档与素材 ID）；`stale-input` 是 `STALE_JOB_INPUT`、
   * `rejected` 是 `APPLY_FAILED`（都是 `failed`，结果保留）；`cancelled` 是任务 `cancelled`，结果保留为候选。
   * 已经终结的任务（重启后补做、`jobs.reconcile apply`）原地改记录。
   */
  async #concludeApplication(entry: Entry, app: ApplicationRecord): Promise<void> {
    const record = entry.record;
    this.#project(entry);
    const result = withApplied(record, app);
    const artifacts = record.kind === 'transcribe' ? { artifactId: app.artifactIds[0] } : { artifactIds: app.artifactIds };
    const generated = record.kind !== 'transcribe';
    let state: JobState;
    let error: JobError | null = null;
    let cancellation: JobCancellation | undefined;
    switch (app.state) {
      case 'committed':
        state = 'completed';
        break;
      case 'cancelled': {
        state = 'cancelled';
        const requestedAt = entry.cancelRequestedAt ?? app.updatedAt;
        cancellation = cancellationFacts(record, 'after-result', requestedAt);
        break;
      }
      case 'stale-input':
        state = 'failed';
        {
          const reason = app.error ? asLocalized(app.error.message, app.error.messageRef) : J.targetGone();
          error = jobError('STALE_JOB_INPUT', generated ? J.staleGeneratedKept({ reason }) : reason, {
            ...artifacts,
            applicationId: app.applicationId,
          });
        }
        break;
      default: {
        state = 'failed';
        if (app.error?.code === 'TRANSCRIPT_EDITED') {
          // 换用文稿时文稿在提交之后又被改过（§6.6）：原样报这个错误码，转录流程的 `transcribe` 一步据此失败。
          error = jobError('TRANSCRIPT_EDITED', asLocalized(app.error.message, app.error.messageRef), {
            ...(app.error.details as Record<string, unknown> | undefined),
            ...artifacts,
            applicationId: app.applicationId,
          });
          break;
        }
        if (app.error?.code === 'TASK_PROTECTED') {
          // 触碰了任务的保护范围（§3.2）：结果留作候选，要不要应用由用户决定（`jobs.reconcile apply` 不受任务保护限制）。
          const { protections } = app.error.details as { protections?: unknown };
          error = jobError('APPLY_FAILED', J.protectedKept({ generated }), {
            ...artifacts,
            applicationId: app.applicationId,
            reason: 'TASK_PROTECTED',
            protections,
          });
          break;
        }
        const cause = (app.error?.details as { cause?: unknown } | undefined)?.cause ?? app.error?.message;
        error = jobError(app.error?.code === 'INTERNAL' ? 'INTERNAL' : 'APPLY_FAILED', J.applyFailedKept({ generated }), {
          ...artifacts,
          applicationId: app.applicationId,
          reason: app.error?.code,
          ...(cause !== undefined ? { cause } : {}),
        });
      }
    }
    if (!isTerminal(record.state)) {
      return this.#finish(entry, state, { result, ...(error ? { error } : {}), ...(cancellation ? { cancellation } : {}) });
    }
    // 已经终结的任务：原地改，不再结算预算（发布时已经结算）。
    Object.assign(record, { state, error, result, endedAt: nowIso() } satisfies Partial<JobRecord>);
    if (cancellation) record.cancellation = cancellation;
    else if (state === 'completed') delete record.cancellation;
    if (entry.leased) {
      entry.leased = false;
      this.#videos.release(app.videoId);
    }
    this.#changed(entry, false);
    await this.#save();
  }

  /**
   * 执行被停下：取消时记下三件事实（§7.4）；Runtime 停止时，外发调用的结果不明（断开请求不等于供应商停下），
   * 标为 `needs-reconciliation`，其余标为 `interrupted`。`confirmed`：执行者确认停下了。
   */
  #stopped(entry: Entry, confirmed = false): Promise<void> {
    const record = entry.record;
    if (entry.cancelRequested) {
      const cancellation = cancellationFacts(record, 'running', entry.cancelRequestedAt ?? nowIso(), { confirmed });
      return this.#finish(entry, 'cancelled', { cancellation });
    }
    // 结果不明的外发调用等用户对账；不能由用户重试的（固定流程的步骤、没有视频的转写）与 open() 一样只是中断。
    if (retryable(entry) && isExternalProvider(record.providerId)) {
      return this.#finish(entry, 'needs-reconciliation', { error: reconciliationError() });
    }
    return this.#finish(entry, 'interrupted', { error: stoppedError() });
  }

  #sink(entry: Entry): TranscribeSink {
    const record = entry.record;
    const attempt = record.attempt;
    const update = (patch: Partial<JobRecord>) => {
      if (record.state !== 'running') return;
      Object.assign(record, patch);
      this.#changed(entry, false);
    };
    return {
      loading: () => update({ phase: 'loading' }),
      // 进度属于它所在的阶段：换阶段时清掉，免得新阶段带着上一阶段的数字。
      phase: (phase) => update(phase === record.phase ? { phase } : { phase, progress: null }),
      progress: (p) => update({ phase: p.phase, progress: { done: p.done, total: p.total, unit: p.unit } }),
      segment: (segment) => {
        // 只收这一次尝试、还在跑时的段落；时间从 tick（素材时钟，`range` 的偏移已含在内）换成秒。
        if (record.state !== 'running' || record.attempt !== attempt) return;
        const live = liveSegment(segment, entry.input.timescale);
        if (!live) return;
        const from = entry.liveSegments.length;
        entry.liveSegments.push(live);
        const notice = { jobId: record.jobId, from, segments: [{ ...live }] };
        for (const listener of this.#segmentListeners) {
          try {
            listener(notice);
          } catch (error) {
            this.#log.error('Task segment listener failed', { error: String(error) });
          }
        }
      },
      warning: (warning) => {
        if (record.state !== 'running') return;
        update({ warnings: [...record.warnings, warning] });
        if (entry.target.kind === 'file') entry.target.observer.warning?.(warning);
      },
      language: (tag, confidence) => {
        if (record.state === 'running' && entry.target.kind === 'file') entry.target.observer.language?.(tag, confidence);
      },
    };
  }

  /** 校验 → 发布 → 应用（§7.3）。`runGeneration`：结果的 `provenance.runGeneration` 应等于的值（见 `TranscribeAttempt`）。 */
  async #complete(entry: Entry, output: JobOutput, staging: string, runGeneration: number): Promise<void> {
    const record = entry.record;
    this.#phase(entry, 'validating');
    const file = path.resolve(staging, output.path);
    const invalid = (problems: string[]) => this.#rejectOutput(entry, file, problems);
    const relative = path.relative(staging, file);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return invalid([J.asrFileNotInStaging().text]);
    const bytes = await fs.readFile(file).catch(() => null);
    if (!bytes) return invalid([J.asrFileMissing().text]);
    if (bytes.length !== output.byteLength) return invalid([J.asrLengthMismatch({ actual: bytes.length, declared: output.byteLength }).text]);
    if (sha256Hex(bytes) !== output.sha256.replace(/^sha256:/, '')) return invalid([J.asrShaMismatch().text]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      return invalid([J.notJson().text]);
    }
    const language = (entry.spec as TranscribeInputSpec).language;
    const validation = validateAsrResult(parsed, {
      runGeneration,
      ...(language.mode === 'assert' ? { assertedLanguage: language.tag } : {}),
    });
    if (!validation.ok) return invalid(validation.problems);
    const result = validation.result;
    if (entry.target.kind === 'file') return this.#deliver(entry, entry.target, file, bytes, result);

    this.#phase(entry, 'publishing');
    const artifactId = artifactIdOf(bytes);
    const warnings: JobWarning[] = [...result.warnings];
    if (result.outcome !== 'transcribed') warnings.push({ code: result.outcome });
    record.warnings = warnings;
    // 没有视频的转写（§7.9）只发布原始结果。
    const onlyPublish = result.outcome !== 'transcribed' || record.videoId === null;
    const targetRefs = onlyPublish ? null : [record.assetId!];
    await this.#publish(entry, { artifactIds: [artifactId], result: { documentId: null, artifactId }, targetRefs, warnings }, async () => {
      await this.#artifacts.put(bytes);
    });

    if (onlyPublish) {
      return this.#finish(entry, 'completed', { result: { documentId: null, artifactId } });
    }
    return this.#applyPublished(
      entry,
      { documentId: null, artifactId },
      { artifactIds: [artifactId], targetRefs: [record.assetId!] },
      result,
    );
  }

  /** 文件目标：校验过的结果移到调用方指定的位置，然后结束。不发布产物，不写视频。 */
  async #deliver(
    entry: Entry,
    target: Extract<JobTarget, { kind: 'file' }>,
    file: string,
    bytes: Buffer,
    result: AsrResult,
  ): Promise<void> {
    const record = entry.record;
    const warnings: JobWarning[] = [...result.warnings];
    if (result.outcome !== 'transcribed') warnings.push({ code: result.outcome });
    record.warnings = warnings;
    await fs.mkdir(path.dirname(target.resultFile), { recursive: true });
    await fs.rename(file, target.resultFile).catch(() => fs.writeFile(target.resultFile, bytes));
    target.observer.output?.({ file: target.resultFile, sha256: sha256Hex(bytes), byteLength: bytes.length });
    return this.#finish(entry, 'completed', {});
  }

  /**
   * 输出不合合同：不重试；原始文件移到诊断目录（§6.5）。远端任务的原始结果含有别人的转写文本，节点不留（§6.7），
   * 只留任务记录与问题清单。
   */
  async #rejectOutput(entry: Entry, file: string, problems: string[]): Promise<void> {
    const record = entry.record;
    const dir = path.join(this.#options.paths.diagnosticsDir, record.jobId);
    await fs.mkdir(dir, { recursive: true });
    if (entry.target.kind === 'video') {
      const kept = path.join(dir, 'result.json');
      await fs.rename(file, kept).catch(() => fs.copyFile(file, kept).catch(() => {}));
    }
    await fs.writeFile(path.join(dir, 'job.json'), `${JSON.stringify({ record, problems }, null, 2)}\n`).catch(() => {});
    this.#log.warn('Model output does not match the contract', { jobId: record.jobId, problems: problems.slice(0, 5) });
    return this.#finish(entry, 'failed', {
      error: jobError('MODEL_OUTPUT_INVALID', J.asrContractInvalid(), { problems }),
    });
  }

  async #finish(
    entry: Entry,
    state: JobState,
    patch: { error?: JobError; result?: JobRecord['result']; cancellation?: JobCancellation },
  ): Promise<void> {
    const record = entry.record;
    if (isTerminal(record.state) && record.state !== 'interrupted') return;
    const now = nowIso();
    Object.assign(record, {
      state,
      phase: 'done',
      endedAt: now,
      error: patch.error ?? null,
      result: patch.result ?? null,
    } satisfies Partial<JobRecord>);
    if (patch.cancellation) record.cancellation = patch.cancellation;
    entry.controller = null;
    // 还在排队的撤回准入请求。
    entry.ticket?.withdraw();
    entry.ticket = null;
    delete record.wait;
    delete entry.publishing;
    await fs.rm(this.#stagingOf(record.jobId), { recursive: true, force: true }).catch(() => {});
    if (entry.leased) {
      entry.leased = false;
      if (record.videoId) this.#videos.release(record.videoId);
    }
    if (record.library) void this.#options.library?.unpin(record.jobId).catch(() => {});
    if (record.grant && !record.grant.settled && this.#options.admission) {
      record.grant = this.#options.admission.settle(record.grant, { state });
    }
    this.#log.info('Task ended', { jobId: record.jobId, state, code: patch.error?.code });
    this.#changed(entry, false);
    this.#prune();
    // 终态先落盘再算结束：settled 之后读账本一定看得到。
    await this.#save();
    entry.settle(state);
  }

  // ---- 外发授权与预算（§12.5、§7.8） ----

  /** 创建记录前的接纳：判断并预留（同步）。本机与节点不经过它。 */
  #admit(
    jobId: Id,
    capability: ModelServiceCapability,
    selection: { providerId: string; modelId: string; kind: ProviderKind; label: string; model: ModelInfoBase },
    videoId: Id | null,
    submitter: JobSubmitter,
    hint: JobGrantHint | undefined,
    quantity: { count?: number; chars?: number },
  ): JobRecord['grant'] | null {
    const admission = this.#options.admission;
    if (!admission || selection.kind === 'local' || selection.kind === 'node') return null;
    return admission.admit({
      jobId,
      capability,
      providerId: selection.providerId,
      providerKind: selection.kind,
      label: selection.label,
      model: selection.model,
      modelId: selection.modelId,
      videoId,
      submitter,
      ...(hint ? { hint } : {}),
      quantity,
    });
  }

  /**
   * 开始执行前：「已开始」落盘之后才放行（§7.8）。授权撤销或被收紧时以 `GRANT_REVOKED` 结束（预留在结束时释放）。
   * 落盘与记下 `running` 之间崩溃时，重启后按「排队但已开始」处理（见 `open()`），不重发。
   */
  async #grantStart(entry: Entry): Promise<JobError | null> {
    const use = entry.record.grant;
    if (!use || use.settled || !this.#options.admission) return null;
    return this.#options.admission.start(use);
  }

  /** 自动重试也是一次调用：结算上一次、再预留一次；额度不够时以它的错误结束。 */
  #grantRetry(entry: Entry): JobError | null {
    const use = entry.record.grant;
    if (!use || !this.#options.admission) return null;
    const next = this.#options.admission.retry(use, {
      providerId: entry.record.providerId,
      videoId: entry.record.videoId,
      submitter: entry.record.submitter,
    });
    if (isJobError(next)) return next;
    entry.record.grant = next;
    return null;
  }

  #phase(entry: Entry, phase: JobPhase): void {
    entry.record.phase = phase;
    this.#changed(entry, false);
  }

  /** 改记录与发事件在同一个同步段里（主题的快照与事件同一水位）。 */
  #changed(entry: Entry, persist: boolean): void {
    // 实时段落只属于在跑的尝试：离开 `running`（终态、中断、待对账、重试前的中断）就丢掉，与发出的 `job.updated` 同一水位。
    if (entry.record.state !== 'running' && entry.liveSegments.length > 0) entry.liveSegments = [];
    entry.record.updatedAt = nowIso();
    const copy = structuredClone(entry.record);
    for (const listener of this.#listeners) {
      try {
        listener(copy);
      } catch (error) {
        this.#log.error('Task event listener failed', { error: String(error) });
      }
    }
    if (persist) void this.#save();
  }

  #save(): Promise<void> {
    if (this.#crashed) return Promise.resolve();
    const jobs = [...this.#entries.values()].map(({ record, spec, workerVersion, videoPlace, remoteTaskId, publishing }) => ({
      record,
      spec,
      workerVersion,
      ...(videoPlace ? { videoPlace } : {}),
      ...(remoteTaskId ? { remoteTaskId } : {}),
      ...(publishing ? { publishing } : {}),
    }));
    return this.#ledger.save(jobs).catch((error: unknown) => this.#log.error('Writing the task ledger failed', { error: String(error) }));
  }

  /**
   * 账本的上限（§7.5）：只数终结的顶层任务，按结束时间从旧到新淘汰；子任务跟着父任务一起删，没结束的父任务的
   * 子任务不动。还能重试的流程（失败、取消、中断）最新的 `maxRetainedRetryablePipelines` 条不淘汰、不占名额。
   * 等对账的（`needs-reconciliation`）不淘汰：用户决定之前一直留着。被淘汰的任务的应用一并删掉。
   */
  #prune(): void {
    const top = (e: Entry) => e.record.parentJobId == null || !this.#entries.has(e.record.parentJobId);
    const endedAt = (e: Entry) => e.record.endedAt ?? e.record.createdAt;
    const terminal = [...this.#entries.values()]
      .filter((e) => top(e) && isTerminal(e.record.state) && e.record.state !== 'needs-reconciliation')
      .sort((a, b) => (endedAt(a) < endedAt(b) ? -1 : endedAt(a) > endedAt(b) ? 1 : 0));
    const retryable = terminal.filter((e) => e.record.kind === 'pipeline' && e.record.state !== 'completed');
    const kept = new Set(retryable.slice(Math.max(0, retryable.length - this.#maxRetainedRetryable)));
    const pool = terminal.filter((e) => !kept.has(e));
    const evicted = new Set(pool.slice(0, Math.max(0, pool.length - this.#maxRetained)).map((e) => e.record.jobId));
    if (evicted.size === 0) return;
    for (const [jobId, entry] of this.#entries) {
      if (evicted.has(jobId) || (entry.record.parentJobId != null && evicted.has(entry.record.parentJobId))) this.#entries.delete(jobId);
    }
    if (!this.#crashed) {
      void this.#applications.remove(evicted).catch((error: unknown) => this.#log.error('Writing the application ledger failed', { error: String(error) }));
    }
    for (const listener of this.#pruneListeners) {
      try {
        listener(evicted);
      } catch (error) {
        this.#log.warn('A prune listener failed', { error: String(error) });
      }
    }
  }

  #byCommand(commandId: Id): Id | null {
    for (const entry of this.#entries.values()) if (entry.commandId === commandId) return entry.record.jobId;
    return null;
  }

  #stagingOf(jobId: Id): string {
    return path.join(this.#options.paths.stagingDir, 'jobs', jobId);
  }

  #entry(stored: StoredJob, input: Entry['input'], commandId: Id | null, target: JobTarget, executor: Entry['executor']): Entry {
    let settle!: (state: JobState) => void;
    const settled = new Promise<JobState>((resolve) => {
      settle = resolve;
    });
    if (isTerminal(stored.record.state)) settle(stored.record.state);
    return {
      ...stored,
      input,
      target,
      commandId,
      executor,
      controller: null,
      ticket: null,
      cancelRequested: false,
      cancelRequestedAt: null,
      leased: false,
      hosted: null,
      settled,
      settle,
      liveSegments: [],
    };
  }
}

/** `JobManager.onSegments` 的一次通知：`from` 是 `segments[0]` 在这个任务全部实时段落里的序号。 */
export interface LiveSegmentsUpdate {
  jobId: Id;
  from: number;
  segments: JobLiveSegment[];
}

/** Worker 的段（tick）→ 实时段落（秒）。空白文字、非有限或倒置的时间丢掉；起止相同的段（`segment-degenerate`）保留。 */
function liveSegment(segment: { start: number; end: number; text: string }, timescale: number): JobLiveSegment | null {
  const text = typeof segment.text === 'string' ? segment.text.trim() : '';
  if (!text || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)) return null;
  if (segment.start < 0 || segment.end < segment.start || !(timescale > 0)) return null;
  return { start: segment.start / timescale, end: segment.end / timescale, text };
}

/** 需求超过机器容量的任务错误（命令与协议规范 §11.3）。 */
function exceededError(error: ResourceExceedsCapacity): JobError {
  return jobError(error.code, errorText(error), { dimensions: error.dimensions });
}

function isTranscribeSpec(spec: StoredJob['spec']): spec is TranscribeInputSpec {
  return !('capability' in spec) && !('task' in spec) && !('hosted' in spec);
}

function isTaskSpec(spec: StoredJob['spec']): spec is TaskInputSpec {
  return 'task' in spec;
}

function isHostedSpec(spec: StoredJob['spec']): spec is HostedJobSpec {
  return 'hosted' in spec;
}

/** Provider 失败 → 任务错误（§11.3）。崩溃的自动重试由转写路径自己处理。 */
function failureError(failure: ProviderFailure, providerId: string): JobError {
  const { details } = failure;
  const message = errorText(failure);
  switch (failure.kind) {
    case 'crashed':
    case 'version-changed':
      return jobError('MODEL_WORKER_CRASHED', message, details);
    case 'load-failed':
    case 'unavailable':
      return jobError('MODEL_LOAD_FAILED', message, details);
    case 'output-unwritable':
      return jobError('STAGING_WRITE_FAILED', message, details);
    case 'input-unreadable':
      // 随应用分发的文件（内置音色的录音）读不出来是安装不完整：`details.code` 是 `APP_FILE_MISSING`。
      return jobError(details.code === 'APP_FILE_MISSING' ? 'APP_FILE_MISSING' : 'ASSET_MISSING', message, details);
    case 'protocol':
      return jobError('MODEL_OUTPUT_INVALID', message, details);
    case 'node-rejected':
      return jobError('REMOTE_NODE_REJECTED', message, details);
    case 'node-lost':
      return jobError('REMOTE_NODE_LOST', message, details);
    case 'remote-failed': {
      // 节点上的任务失败：错误码与说明原样，详情里加上节点。
      const { code, node, details: remote } = details;
      const extra = remote && typeof remote === 'object' && !Array.isArray(remote) ? (remote as Record<string, unknown>) : {};
      return jobError(typeof code === 'string' ? code : 'INTERNAL', message, { ...extra, node });
    }
    case 'rejected': {
      const { code, ...rest } = details;
      const errorCode = typeof code === 'string' && PROVIDER_REJECTION_CODES.has(code) ? code : 'PROVIDER_REJECTED';
      return jobError(errorCode, message, { ...rest, providerId });
    }
    case 'unavailable-remote':
      return jobError('PROVIDER_UNAVAILABLE', message, { ...details, providerId });
  }
}

function stoppedError(): JobError {
  return jobError('JOB_INTERRUPTED', J.interrupted());
}

function reconciliationError(): JobError {
  return jobError('JOB_NEEDS_RECONCILIATION', J.needsReconciliation());
}

/** 重新执行之前准备好的输入、执行者与新的预留。 */
interface Prepared {
  input: Entry['input'];
  executor: NonNullable<Entry['executor']>;
  grant: JobGrantUse | null;
}

/**
 * 校验、准入或打开视频的失败 → 任务错误：`RpcError` 的 `details.code`（`GRANT_REQUIRED`、`CAPABILITY_NOT_CONFIGURED`……）
 * 优先，没有时用 `fallback`（`force` 时总是用它）。
 */
function rpcJobError(error: unknown, message: JobText, fallback: string, force = false): JobError {
  const cause = error instanceof Error ? error.message : String(error);
  if (error instanceof RpcError) {
    const details = error.details as { code?: unknown } | undefined;
    const code = !force && typeof details?.code === 'string' ? details.code : fallback;
    return jobError(code, withCause(message, error), { ...(details ?? {}), cause });
  }
  return jobError(force ? fallback : 'INTERNAL', message, { cause });
}

/** 应用提交之后的结果：转写补上 `speech` 文档，生成补上各个输出导入的素材。 */
function withApplied(record: JobRecord, app: ApplicationRecord): JobRecord['result'] {
  const result = record.result;
  if (!result || app.state !== 'committed' || !app.receipt) return result;
  const refs = app.receipt.refs;
  if (record.kind === 'transcribe') return { ...result, documentId: refs.speech ?? null };
  return {
    ...result,
    ...(result.outputs ? { outputs: result.outputs.map((o, i) => ({ ...o, assetId: refs[app.targetRefs[i]!] ?? null })) } : {}),
  };
}

/** 换用文稿的请求：文档在、是这个素材的转写，指纹与版本是字符串。不成立时 `invalid-request`。 */
function checkReplace(replace: TranscriptReplace, assetId: Id, state: { documents: Record<Id, DocumentRecord> } | null): TranscriptReplace {
  const record = state?.documents[replace.documentId];
  if (!state || !record || record.kind !== 'speech' || record.sourceAssetId !== assetId) {
    throw new RpcError('invalid-request', JobsTranscribe.replaceDocumentGone(), { documentId: replace.documentId });
  }
  if (typeof replace.fingerprint !== 'string' || !replace.fingerprint || typeof replace.revision !== 'string') {
    throw new RpcError('invalid-request', JobsTranscribe.transcriptUnreadable());
  }
  return {
    documentId: replace.documentId,
    revision: replace.revision,
    fingerprint: replace.fingerprint,
    translations: replace.translations === 'discard' ? 'discard' : 'carry',
  };
}

/**
 * 新转写的正文记下 `stages.asr`（视频格式规范 §5.5：转写完成时全文的内容指纹），之后据此判断有没有人改过原文。句子与指纹的
 * WASM 没有构建时不记（与早先写的转写一样，当作没改过）。
 */
function withAsrStage(operation: EditOperation): EditOperation {
  if (operation.type !== 'putDocument' || !operation.body || typeof operation.body !== 'object') return operation;
  try {
    const body = operation.body as Record<string, unknown>;
    return { ...operation, body: { ...body, stages: { asr: contentFingerprint(body) } } };
  } catch (error) {
    if (error instanceof EditorWasmError) return operation;
    throw error;
  }
}

function normalizeLanguage(language: TranscribeRequest['language']): TranscribeInputSpec['language'] {
  if (!language) return { mode: 'prefer', tag: null };
  if (language.tag === null) return { mode: 'prefer', tag: null };
  const tag = canonicalLanguageTag(language.tag);
  if (!tag) throw new RpcError('invalid-request', J.invalidLanguageTag({ tag: language.tag }));
  return language.mode === 'assert' ? { mode: 'assert', tag } : { mode: 'prefer', tag };
}

/** 按流算文件的 sha256（小写十六进制）。读不了时 `invalid-request`。 */
async function fileSha256(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  try {
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  } catch {
    throw new RpcError('invalid-request', J.cannotReadInput());
  }
  return hash.digest('hex');
}
