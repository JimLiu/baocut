import type {
  GrantDataKind,
  Id,
  JobError,
  JobGrantUse,
  JobState,
  JobSubmitter,
  ModelInfoBase,
  ModelServiceCapability,
  Money,
  ProviderKind,
} from '@baocut/protocol';

/**
 * 外发调用的接纳（架构设计 §12.5、§7.8）：JobManager 在创建记录之前、开始执行之前、自动重试之前与结束时调用它。
 * 判断授权与预留预算由实现（Runtime 的授权服务）负责；JobManager 只在这些时刻调用、把结果记在任务记录的 `grant` 上。
 *
 * - `admit` 是同步的：判断与预留在同一个事件循环回合里完成，紧接着创建记录，并行的提交不会一起越过上限。
 * - 本机（`local`）与节点（`node`）的调用不经过这里：本机不外发，节点是用户配对过的设备。
 */

/** 调用方对这次调用的说明：用哪条授权（审批时为这一次发放的）、外发哪些数据（不给时按能力推出）。 */
export interface JobGrantHint {
  grantId?: Id;
  dataKinds?: GrantDataKind[];
}

export interface JobAdmissionRequest {
  jobId: Id;
  capability: ModelServiceCapability;
  providerId: string;
  providerKind: ProviderKind;
  /** Provider 的显示名（错误信息用）。 */
  label: string;
  /** 选定的模型（带单价时可以估算金额）。 */
  model: ModelInfoBase;
  modelId: string;
  videoId: Id | null;
  submitter: JobSubmitter;
  hint?: JobGrantHint;
  /** 估算金额用的输入量：图片张数、合成文本的字符数。 */
  quantity: { count?: number; chars?: number };
}

export interface JobAdmission {
  /** 判断并预留（同步）。不需要授权时返回 null；没有授权、额度不够时抛 `RpcError`（`GRANT_REQUIRED`、`BUDGET_EXCEEDED`……）。 */
  admit(request: JobAdmissionRequest): JobGrantUse | null;
  /**
   * 开始执行（数据即将交出）之前：授权还有效时把预留记为已开始，**落盘之后**兑现 null（§7.8：重启后不会把已经发出的
   * 调用当成没开始而释放）；撤销、到期或被收紧时兑现任务错误（`GRANT_REVOKED`），写不进磁盘时兑现 `INTERNAL`。
   */
  start(use: JobGrantUse): Promise<JobError | null>;
  /** 这笔预留已经记为开始（重启时：排队的任务若已开始过，说明请求可能已经发出，不能重新排队）。 */
  begun?(use: JobGrantUse): boolean;
  /** 自动重试：结算上一次尝试并再预留一次。额度不够时返回任务错误（`BUDGET_EXCEEDED`）。 */
  retry(use: JobGrantUse, call: { providerId: string; videoId: Id | null; submitter: JobSubmitter }): JobGrantUse | JobError;
  /** 任务结束时结算。 */
  settle(use: JobGrantUse, outcome: { state: JobState; reported?: Money | null }): JobGrantUse;
}

export function isJobError(value: JobGrantUse | JobError): value is JobError {
  return 'code' in value;
}
