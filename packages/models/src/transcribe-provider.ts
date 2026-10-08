import type { AsrWarning, JobInput, JobOutput, Segment, TranscribeJobPhase, TranscribeOptions } from './worker-contract.ts';
import type { MessageRef } from '@baocut/protocol';
import { modelTextRef, type ModelText } from './model-text.ts';

/**
 * 语音识别的 Provider 接口（架构设计 §6.1、§6.6）：同一能力不绑定某一个来源。本地 Provider（Model Worker，实现在
 * `@baocut/jobs`）、远端节点 Provider（§6.7，实现在 `@baocut/nodes`）与在线 Provider（§6.4，实现在 `@baocut/providers`）
 * 实现同一个接口，都输出同一份 `baocut.asr-result/v1`，由 JobManager 统一校验、发布与应用。
 *
 * 一次 `transcribe` 是一次尝试：重试、校验、发布都不在 Provider 里。
 */

export interface TranscribeRun {
  jobId: string;
  /** 第几次尝试；Worker 原样回填到结果的 `provenance.runGeneration`。 */
  runGeneration: number;
  /** 选中的 Provider 与模型（§6.2）。在线 Provider 据此决定发给谁、用哪个模型。 */
  providerId?: string;
  modelId?: string;
  /** 本地与节点的模型包；在线 Provider 为 null。 */
  bundleId: string | null;
  input: JobInput;
  options: TranscribeOptions;
  /** 这次尝试的 staging 目录（绝对路径）；Provider 只能把结果写在这里。 */
  staging: string;
  /** 重试时要求与第一次相同的 Worker 版本（架构设计 §6.5）。 */
  expectedWorkerVersion?: string;
  /** 输入的媒体类型（素材记录里的）；远端节点要它，本地 Worker 不用。 */
  mediaType?: string;
  /** 远端节点 Provider 的目标节点（`nodeId`）；不给时取 `providerId` 的 `node:<nodeId>`。本地 Provider 没有。 */
  node?: string;
}

/** Provider 回报的事实。JobManager 据此更新 `jobs` 主题。 */
export interface TranscribeSink {
  /** 正在启动 Worker 或加载模型。 */
  loading(): void;
  phase(phase: TranscribeJobPhase): void;
  progress(progress: { phase: TranscribeJobPhase; done: number; total: number | null; unit: 'seconds' | 'segments' }): void;
  segment(segment: Segment): void;
  warning(warning: AsrWarning): void;
  language(tag: string, confidence: number | null): void;
}

export type TranscribeAttempt =
  | {
      outcome: 'completed';
      output: JobOutput;
      workerVersion: string;
      /**
       * 结果的 `provenance.runGeneration` 应等于的值。不给时就是这次尝试的序号（本地 Worker 原样回填它）；远端节点的结果
       * 回填的是节点自己的尝试序号（节点上 Worker 崩溃重试后为 2），由 Provider 按节点报告的任务记录给出。
       */
      runGeneration?: number;
    }
  | {
      outcome: 'cancelled';
      workerVersion: string | null;
      /** 取消本身的警告，例如远端节点没有确认已经停下（`remote-cancel-unconfirmed`）。 */
      warnings?: Array<{ code: string; detail?: string }>;
    };

/**
 * 一次尝试的失败，按恢复方式分类：
 * - `load-failed`：模型包加载不了（未安装、不支持、资源不足、合同不符），不重试；
 * - `crashed`：推理进程崩溃或推理失败，可以按 §6.5 重试一次；
 * - `version-changed`：重试时 Worker 版本变了，不重试；
 * - `input-unreadable`：输入文件读不了，不重试；
 * - `output-unwritable`：Worker 的输出写不进 staging（磁盘满、权限），与模型无关：不计崩溃、不停用模型包，不重试；
 * - `unavailable`：Provider 此刻不可用（模型包已停用、没有 Worker 可执行文件），不重试；
 * - `protocol`：响应不合协议（例如 `completed` 却没有输出），按输出不合合同处理，不重试；
 * - `node-rejected`：远端节点拒绝（未配对、版本、能力关闭、模型未就绪……），`details.reason` 与 `details.node`，不重试；
 * - `node-lost`：远端节点连不上或失联（`details.reason`：`unreachable`、`stream-lost`、`node-restarted`），不重试；
 * - `remote-failed`：任务在远端节点上失败：`details.code` 是节点给出的错误码（原样），`details.details` 是节点的详情，不重试
 *   （节点自己已经按 §6.5 重试过 Worker 崩溃）；
 * - `rejected`：在线 Provider 拒绝了请求（认证、配额、参数），`details.code` 是 `PROVIDER_AUTH_FAILED`、
 *   `PROVIDER_QUOTA_EXCEEDED` 或 `PROVIDER_REJECTED`，不重试；
 * - `unavailable-remote`：在线 Provider 连不上或一直 5xx（适配器自己已经退避重试过），`PROVIDER_UNAVAILABLE`，JobManager 不再重试。
 *
 * 在线 Provider 的 `message` 与 `details` 不得含密钥（§6.4）。
 */
export type ProviderFailureKind =
  | 'load-failed'
  | 'crashed'
  | 'version-changed'
  | 'input-unreadable'
  | 'output-unwritable'
  | 'unavailable'
  | 'protocol'
  | 'node-rejected'
  | 'node-lost'
  | 'remote-failed'
  | 'rejected'
  | 'unavailable-remote';

export class ProviderFailure extends Error {
  readonly kind: ProviderFailureKind;
  readonly details: Record<string, unknown>;
  /** 用目录文字构造时的消息引用。 */
  readonly messageRef: MessageRef | undefined;

  constructor(kind: ProviderFailureKind, message: ModelText, details: Record<string, unknown> = {}) {
    super(String(message));
    this.messageRef = modelTextRef(message);
    this.name = 'ProviderFailure';
    this.kind = kind;
    this.details = details;
  }
}

export interface TranscribeProvider {
  readonly id: string;
  /**
   * 执行一次尝试。`signal` 中止时 Provider 尽快停下并以 `cancelled` 兑现（本地 Provider：`job.cancel`，
   * 超过期限就结束进程）；还在启动或加载时立即兑现，加载在后台继续。
   */
  transcribe(run: TranscribeRun, sink: TranscribeSink, signal: AbortSignal): Promise<TranscribeAttempt>;
  /** 用户重新启用一个模型包：清掉 Provider 自己记下的失败（例如崩溃计数）。 */
  enable?(bundleId: string): void;
  /** 正常停止：关闭持有的进程或连接。 */
  close(): Promise<void>;
}
