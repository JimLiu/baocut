import type { FrozenLibraryEntry, Id, JobCallCounts, JobPhase, JobProgress, JobRecord, JobSubmitter, JobWarning } from '@baocut/protocol';
import type { ArtifactStore } from '../artifact-store.ts';
import { LocalizedError, type JobText, type LazyText } from '../job-text.ts';
import type { TaskResources } from '../job-manager.ts';
import type { PipelineTargetSupport, VideoLease } from './video-target.ts';

/**
 * 固定流程（架构设计 §7.9）的定义：步骤固定、参数在启动时校验并冻结。`PipelineRunner` 把一次执行记成一个父任务
 * （`kind: 'pipeline'`），每一步记成它的一个子任务（`kind: 'pipeline-step'`）。步骤之间只经产出（`output`）传递
 * 结果：产物 ID、staging 或输出目录里的文件、写入视频的文档引用；产出记在父任务上并落盘，重试时复用。
 */

/** 一步的产出：可以 JSON 序列化（记进任务账本）。 */
export type StepOutput = Record<string, unknown>;

/** 之前各步的产出（按步骤名；跳过的步骤为 null）。 */
export type StepOutputs = Readonly<Record<string, StepOutput | null>>;

/** 步骤完成时的产出，和交给子任务的结果（与 `JobRecord.result` 同形；没有产物时不给）。 */
export interface StepResult {
  output: StepOutput;
  result?: NonNullable<JobRecord['result']>;
}

/** 报告进度与阶段。 */
export type ProgressReporter = (progress: JobProgress | null, phase?: JobPhase) => void;

export interface PipelineStepContext<P> {
  /** 冻结的参数。 */
  readonly params: P;
  readonly parentJobId: Id;
  /** 这一步的子任务。 */
  readonly jobId: Id;
  /** 第几次执行这一步（从 1 开始）。 */
  readonly attempt: number;
  /**
   * 这次执行（架构设计 §7.4）：`runId` 是父任务，`runGeneration` 是父任务的 `attempt`。写视频时随 `apply` 交给引擎：
   * 流程被取消之后，引擎拒绝这一代的提交（停止屏障）。
   */
  readonly run: { runId: Id; runGeneration: string };
  /** 取消、Runtime 停止时中止。步骤收到中止要尽快以异常结束，不留下半成品。 */
  readonly signal: AbortSignal;
  readonly outputs: StepOutputs;
  /** 这次执行专用的 staging 目录（`<staging>/pipelines/<父任务>`，已创建）：失败与中断时保留供重试，完成与取消时删除。 */
  readonly staging: string;
  readonly artifacts: ArtifactStore;
  /** 子任务照写；父任务跟着更新阶段与调用计数。 */
  progress: ProgressReporter;
  /** 警告的 `detail` 用 `jobWarning(code, J.x(...))` 生成，引用随之记下。 */
  warn(warning: JobWarning): void;
  /**
   * 在这一步下多开一个子任务（一步产生多个子 Job，例如逐段合成语音）：记录与这一步的子任务同形（同一个 `parentJobId`
   * 与 `step`），`fn` 结束时随之终结。父任务被取消时 `signal` 中止。
   */
  spawn<T>(label: JobText, fn: (job: { jobId: Id; progress: ProgressReporter }) => Promise<T>): Promise<T>;
  /**
   * 这一步新建的视频交给流程持有（`holdsVideo` 的步骤用）：租约到流程结束、取消或失败时放下，父任务与之后的子任务
   * 记上这个视频。
   */
  hold(lease: VideoLease): void;
}

export interface PipelineStep<P> {
  name: string;
  /** 给人看的步骤名：目录条目（`() => J.stepX()`，在用的时候按当前语言生成）或字符串。 */
  label: LazyText;
  /** 可选步骤：返回 false 时记为 `skipped`，不开子任务。 */
  when?: (params: P, outputs: StepOutputs) => boolean;
  run(context: PipelineStepContext<P>): Promise<StepResult>;
  /**
   * 这一步的峰值需求（架构设计 §7.7，估计在 `resource-profiles.ts`）：给了时先经资源调度准入再执行，子任务上记着在等什么；
   * 这一步结束（含取消、失败）后归还。不给时直接执行（只调用在线服务、只写小文件的步骤）。
   */
  resources?: (params: P, outputs: StepOutputs) => TaskResources;
  /** 重试时之前完成的产出是否还能用（例如 staging 里的文件还在）；不能用时从这一步重新执行。没有时一律能用。 */
  reusable?: (output: StepOutput, context: { params: P; staging: string; artifacts: ArtifactStore }) => Promise<boolean>;
  /**
   * 这一步的产出 `{ videoId, place }` 是流程持有租约的视频（解析目标、新建视频）：重试时先按 `place` 重新取得租约，
   * 再做启动前的检查；打开的已经不是那个视频时拒绝重试（`STALE_JOB_INPUT`）。
   */
  holdsVideo?: boolean;
}

/** 启动（与重试）时的检查结果：冻结的参数与记录上的执行者。 */
export interface PipelinePlan<P> {
  /** 冻结的参数（例如补上选定的 Provider 与模型，之后每次调用都照用）。 */
  params: P;
  /** 记录上的执行者：模型流程是选定的 Provider 与模型，文件转码是 `ffmpeg`。 */
  providerId: string;
  modelId: string;
  /** 要写入的视频（任务期间持有它的租约）；不碰视频时 null。 */
  videoId: Id | null;
  /** 输入的内容摘要 `sha256:<hex>`。 */
  contentHash: string;
  /**
   * 用到的用户库条目与冻结的版本（例如翻译用的术语表）：启动时以父任务为持有者固定，流程结束时解除（架构设计 §5.9）；
   * 记在父任务的 `library` 上。重试时尽量再固定一次（之前的固定在 Runtime 重启后不在了）。
   */
  library?: FrozenLibraryEntry[];
}

export interface PipelinePrepareOptions {
  retry: boolean;
  /** 发起流程的一方（重试时是父任务记下的）。授权与任务预算按它所在的任务判断；对外服务的客户端不能用用户库（§5.9）。 */
  submitter?: JobSubmitter;
}

/** `P` 是冻结的参数（执行与重试都只读它），`R` 是校验过、还没冻结的参数（冻结时补上默认值与选定的执行者）。 */
export interface PipelineDefinition<P, R = P> {
  name: string;
  /** 给人看的流程名与说明：目录条目（在用的时候按当前语言生成）或字符串。 */
  label: LazyText;
  description: LazyText;
  /** 参数的 JSON Schema（`pipelines.list` 原样交出）。 */
  paramsSchema: Record<string, unknown>;
  /** 校验参数：不合时抛 `RpcError('invalid-request')`。 */
  parse(raw: Record<string, unknown>): R;
  /**
   * 接受视频目标（`target`，§7.9）：`PipelineRunner` 先读 `target` 与 `videoId`，`entryId` 解析成视频并以租约打开，
   * 交给 `parse` 的是 `videoId`（新建视频时原样交 `target`）。第一步要是 `targetStep()`。
   */
  target?: PipelineTargetSupport;
  /**
   * 启动前的检查（视频打开着、能力已配置……）并冻结参数，不合时抛 `RpcError`。重试时以冻结的参数再查一次（`retry: true`）。
   * `submitter` 是启动它的一方（重试时是原来的提交者）：授权与任务预算的判断按它所在的任务。
   */
  prepare(params: R | P, options: PipelinePrepareOptions): Promise<PipelinePlan<P>>;
  steps: Array<PipelineStep<P>>;
  /** 全部步骤完成后：父任务的结果与摘要。 */
  complete(context: { params: P; outputs: StepOutputs; artifacts: ArtifactStore }): Promise<{
    summary: Record<string, unknown>;
    result: NonNullable<JobRecord['result']>;
  }>;
}

/** 步骤以确定的错误码失败（命令与协议规范 §11.3）。 */
export class PipelineStepError extends LocalizedError {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  /** `message` 给目录文字（`Localized`）时引用随错误记进任务。 */
  constructor(code: string, message: JobText, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PipelineStepError';
    this.code = code;
    this.details = details;
  }
}

/** 逐批调用模型的步骤自己数的调用、重试与失败。 */
export class CallCounter implements JobCallCounts {
  calls = 0;
  retries = 0;
  failures = 0;

  snapshot(): JobCallCounts {
    return { calls: this.calls, retries: this.retries, failures: this.failures };
  }
}
