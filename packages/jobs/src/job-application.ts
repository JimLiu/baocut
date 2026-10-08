import {
  RpcError,
  newId,
  nowIso,
  type ApplicationRecord,
  type ApplicationState,
  type EditOperation,
  type Id,
  type JobError,
} from '@baocut/protocol';
import { JobsApplication as J } from '@baocut/protocol/messages/jobs/job-application.ts';
import type { ApplicationLedger, StoredApplication, VideoPlace } from './application-ledger.ts';
import { errorText, jobError, LocalizedError, type JobText } from './job-text.ts';

/**
 * 把一个任务的结果应用到视频（架构设计 §7.3）：
 *
 * ```text
 * 创建 Application（pending，落账）→ 读当前视频、检查目标与输入
 *   → 记下 commandId 与 baseVideoRevision（validating，落账）→ 提交幂等的事务 → 记回执（committed，落账）
 * ```
 *
 * - 每次提交用新的 `commandId`（`cmd_<applicationId>_<n>`）：同一个命令带不同载荷会被引擎当作幂等冲突，所以重新校验
 *   之后从不复用旧的命令。复用之前一律先按旧命令查回执，查到就是已经提交了，补记，不再写。
 * - 停止屏障（§7.4）：提交之前最后检查一次任务有没有被要求停下；停下了就是 `cancelled`，产物留作候选。
 *   提交带着这次执行（`run`）：停止时 Runtime 先让引擎失效这一代，检查之后才到引擎的那一笔被引擎拒绝（`TASK_STOPPED`），
 *   同样记 `cancelled`（`details.barrier: 'engine'`），不查回执——被拒的提交没有开事务。
 * - 任务保护（§3.2）：智能体任务下的写入带着任务合同对这个视频的保护范围，触碰时引擎整笔拒绝（`TASK_PROTECTED`）。
 *   记 `rejected`、错误码 `TASK_PROTECTED`，不查回执、不重试；产物留作候选，用户可以用 `jobs.reconcile apply` 自己决定。
 * - 视频在读与写之间被改过（`conflict`）时重新读、换命令再提交，至多 `APPLY_ATTEMPTS` 次。
 * - 其他提交错误（引擎重启、连接断开……）不知道事务有没有落下：先按这次的命令查回执，查到算提交，查不到算 `rejected`。
 */

export const APPLY_ATTEMPTS = 3;

/** 目标或输入已经不成立：不猜相邻对象，产物留作候选。构造时给目录文字（`Localized`），引用随任务错误记下。 */
export class StaleInput extends LocalizedError {}

/**
 * 应用前的检查拒绝了这次写入，原因有确定的错误码（例如换用文稿时文稿又被改过，`TRANSCRIPT_EDITED`）：记 `rejected`，
 * 不提交、不重试，任务的错误码就是它。
 */
export class ApplyRejected extends LocalizedError {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: JobText, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/** 故障注入点（测试用）：在这些时刻模拟进程崩溃。 */
export type JobFaultPoint =
  /** 产物已经写进产物库（发布意图已落账），结果与应用都还没有记下。 */
  | 'artifact-stored'
  /** 产物已经发布，还没有创建应用。 */
  | 'artifact-published'
  /** 应用已经记为 `validating`（带 `commandId`），还没有提交事务。 */
  | 'application-recorded'
  /** Node 侧的停止检查已经通过，事务正要交给引擎。 */
  | 'application-submitting'
  /** 事务已经提交，还没有记下回执。 */
  | 'application-committed';

/** 返回 `'crash'` 时在这一刻模拟崩溃：之后什么都不落盘，任务被丢下（像进程没了一样）。 */
export type JobFaults = (point: JobFaultPoint, context: { jobId: Id; applicationId?: Id }) => 'crash' | void;

/** 模拟的崩溃：JobManager 收到它就冻结账本、丢下任务。 */
export class SimulatedCrash extends Error {
  readonly point: JobFaultPoint;

  constructor(point: JobFaultPoint) {
    super(`Simulated crash: ${point}`);
    this.point = point;
  }
}

/** 任务与流水线的写入所属的执行（§7.4）：`runGeneration` 是十进制整数字符串，重试换代时递增。 */
export interface ApplicationRun {
  runId: Id;
  runGeneration: string;
}

/** 应用要的视频能力（`JobVideos` 的一部分）。 */
export interface ApplicationVideos {
  apply(
    videoId: Id,
    request: { commandId: Id; expectedRevision: string; operations: EditOperation[]; label: string; run?: ApplicationRun },
  ): Promise<{ refs?: Record<string, Id>; transactionId?: Id; videoRevision?: string }>;
  receipt?(videoId: Id, commandId: Id): Promise<AppliedReceipt | null>;
}

/** 引擎按 `commandId` 查到的回执。 */
export interface AppliedReceipt {
  transactionId: Id;
  videoRevision: string;
  refs?: Record<string, Id>;
}

/** 一次应用要写什么：校验（返回当前视频版本，不成立时抛 `StaleInput`）与操作。 */
export interface ApplicationTarget {
  label: string;
  check(): string;
  operations(): Promise<EditOperation[]>;
}

export class ApplicationRunner {
  readonly #ledger: ApplicationLedger;
  readonly #videos: ApplicationVideos;
  readonly #faults: JobFaults | undefined;

  constructor(options: { ledger: ApplicationLedger; videos: ApplicationVideos; faults?: JobFaults }) {
    this.#ledger = options.ledger;
    this.#videos = options.videos;
    this.#faults = options.faults;
  }

  /** 创建一条应用并落账（`pending`）。 */
  async create(input: {
    jobId: Id;
    videoId: Id;
    artifactIds: string[];
    targetRefs: string[];
    place: VideoPlace | null;
  }): Promise<StoredApplication> {
    const now = nowIso();
    const item: StoredApplication = {
      record: {
        applicationId: newId('app'),
        jobId: input.jobId,
        artifactIds: input.artifactIds,
        videoId: input.videoId,
        targetRefs: input.targetRefs,
        baseVideoRevision: null,
        commandId: null,
        state: 'pending',
        receipt: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      },
      place: input.place,
      submissions: 0,
    };
    await this.#ledger.put(item);
    return item;
  }

  /**
   * 校验并提交，直到 `committed`、`stale-input`、`rejected` 或 `cancelled`。返回结束时的应用。
   * `run` 是这次执行（引擎侧的停止屏障）；用户自己决定的补做（`jobs.reconcile apply`）不带。
   */
  async run(item: StoredApplication, target: ApplicationTarget, stopped: () => boolean, run?: ApplicationRun): Promise<ApplicationRecord> {
    const app = item.record;
    for (let attempt = 1; ; attempt++) {
      if (stopped()) return this.#end(item, 'cancelled', cancelledError());
      let revision: string;
      let operations: EditOperation[];
      try {
        revision = target.check();
        operations = await target.operations();
      } catch (error) {
        if (error instanceof StaleInput) return this.#end(item, 'stale-input', jobError('STALE_JOB_INPUT', errorText(error)));
        if (error instanceof ApplyRejected) return this.#end(item, 'rejected', jobError(error.code, errorText(error), error.details));
        throw error;
      }
      item.submissions++;
      app.commandId = `cmd_${app.applicationId}_${item.submissions}`;
      app.baseVideoRevision = revision;
      app.state = 'validating';
      await this.#ledger.put(item);
      this.#fault('application-recorded', app);
      // 停止屏障：提交之前最后一次检查。
      if (stopped()) return this.#end(item, 'cancelled', cancelledError());
      this.#fault('application-submitting', app);
      let receipt: AppliedReceipt & { recovered?: true };
      try {
        const result = await this.#videos.apply(app.videoId, {
          commandId: app.commandId,
          expectedRevision: revision,
          operations,
          label: target.label,
          ...(run ? { run } : {}),
        });
        receipt = { transactionId: result.transactionId ?? '', videoRevision: result.videoRevision ?? '', refs: result.refs ?? {} };
      } catch (error) {
        // 引擎侧的停止屏障拒绝了这一笔：没有开事务，不必查回执。
        if (taskStopped(error)) return this.#end(item, 'cancelled', { ...cancelledError(), details: { barrier: 'engine' } });
        // 触碰了任务的保护范围：同样没有开事务；换命令重试也一样，留给用户决定。
        if (taskProtected(error)) return this.#end(item, 'rejected', protectedError(error));
        // 视频在读与写之间被改过：重新读，换一个命令再提交。
        if (error instanceof RpcError && error.code === 'conflict' && attempt < APPLY_ATTEMPTS) continue;
        const found = await this.lookup(item).catch(() => null);
        if (found) {
          receipt = found;
        } else {
          return this.#end(
            item,
            'rejected',
            jobError(error instanceof RpcError ? 'APPLY_FAILED' : 'INTERNAL', J.applyFailed(), {
              cause: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }
      this.#fault('application-committed', app);
      return this.commit(item, receipt);
    }
  }

  /** 按这条应用最近的 `commandId` 向引擎查回执；没有提交过、查不到时 null。查询本身失败时抛出。 */
  async lookup(item: StoredApplication): Promise<(AppliedReceipt & { recovered: true }) | null> {
    const { commandId, videoId } = item.record;
    if (!commandId || !this.#videos.receipt) return null;
    const found = await this.#videos.receipt(videoId, commandId);
    return found ? { ...found, recovered: true } : null;
  }

  /** 记下回执（`committed`）。 */
  async commit(item: StoredApplication, receipt: AppliedReceipt & { recovered?: true }): Promise<ApplicationRecord> {
    const app = item.record;
    app.state = 'committed';
    app.error = null;
    app.receipt = {
      transactionId: receipt.transactionId || null,
      videoRevision: receipt.videoRevision || null,
      refs: receipt.refs ?? {},
      ...(receipt.recovered ? { recovered: true as const } : {}),
    };
    await this.#ledger.put(item);
    return structuredClone(app);
  }

  /** 以没有提交的状态结束。 */
  async end(item: StoredApplication, state: Exclude<ApplicationState, 'pending' | 'validating' | 'committed'>, error: JobError) {
    return this.#end(item, state, error);
  }

  async #end(item: StoredApplication, state: ApplicationState, error: JobError): Promise<ApplicationRecord> {
    item.record.state = state;
    item.record.error = error;
    await this.#ledger.put(item);
    return structuredClone(item.record);
  }

  #fault(point: JobFaultPoint, app: ApplicationRecord): void {
    if (this.#faults?.(point, { jobId: app.jobId, applicationId: app.applicationId }) === 'crash') throw new SimulatedCrash(point);
  }
}

/** 引擎的停止屏障拒绝了提交（`TASK_STOPPED`，命令与协议规范 §11.3）。 */
export function taskStopped(error: unknown): boolean {
  return error instanceof RpcError && (error.details as { code?: unknown } | undefined)?.code === 'TASK_STOPPED';
}

/** 引擎的任务保护拒绝了提交（`TASK_PROTECTED`，命令与协议规范 §11.2）。 */
export function taskProtected(error: unknown): error is RpcError {
  return error instanceof RpcError && (error.details as { code?: unknown } | undefined)?.code === 'TASK_PROTECTED';
}

/** 应用记录里的拒绝原因：被触碰的保护（`protectionId`、`target`、`entityIds`）。 */
function protectedError(error: RpcError): JobError {
  const body = error.details as { details?: { protections?: unknown } } | undefined;
  return jobError('TASK_PROTECTED', J.taskProtected(), { protections: body?.details?.protections ?? [] });
}

export function cancelledError(): JobError {
  return jobError('APPLICATION_CANCELLED', J.applicationCancelled());
}

/** 还没有结束的应用（`pending`、`validating`）。 */
export function applicationOpen(state: ApplicationState): boolean {
  return state === 'pending' || state === 'validating';
}
