import { TopicLog, type Logger } from '@baocut/harness';
import type { JobAdmission, JobAdmissionRequest } from '@baocut/jobs';
import { capabilityLabel, type ModelServices } from '@baocut/models';
import {
  CAPABILITY_DATA_KINDS,
  MODEL_SERVICE_CAPABILITIES,
  PROVIDER_ENABLE_DATA_KINDS,
  RpcError,
  estimateCallCost,
  refOf,
  type ApprovalGrantChoice,
  type Grant,
  type GrantCreateParams,
  type GrantDataKind,
  type GrantRequestItem,
  type GrantRevokeResult,
  type GrantUpdateParams,
  type GrantUsageReport,
  type GrantsEvent,
  type GrantsSnapshot,
  type Id,
  type JobError,
  type JobGrantUse,
  type JobRecord,
  type JobState,
  type JobSubmitter,
  type Localized,
  type MessageRef,
  type ModelCost,
  type ModelInfoBase,
  type ModelServiceCapability,
  type Money,
  type ProviderKind,
  type TaskBudgetLimits,
  type TaskBudgetPolicy,
} from '@baocut/protocol';
import { GrantStore, type GrantCall, type GrantEvaluation, type GrantReservation } from '@baocut/runtime-storage';
import {
  grantRevokedJobError,
  grantRpcError,
  retryBudgetJobError,
  taskBudgetRpcError,
  approvableReason,
  withPendingGrants,
  type GrantErrorContext,
} from './grant-errors.ts';
import { RcGrants } from '@baocut/protocol/messages/runtime-core';
import { jobMessage } from '../localized.ts';

/**
 * 数据外发的授权与预算（架构设计 §12.5、§7.8）：账本（`GrantStore`）之上的服务。
 *
 * - JobManager 的接纳（`JobAdmission`）：提交在线、智能体 Provider 的任务时判断并预留，开始执行前查代，结束时结算；
 * - 工具与对外服务在审批之前用 `plan` 判断这次调用要不要授权、额度够不够；审批允许后用 `issueForApproval` 发放授权；
 * - 启用 Provider 时发放默认授权（§6.8 的迁移规则）：按能力推出数据种类（`PROVIDER_ENABLE_DATA_KINDS`）、不设金额上限、
 *   按次计金额未知；停用或移除时撤销；
 * - 任务预算（§3.2、§7.8）：每个外发调用在授权之外还要通过它所在任务的预算；智能体提交的 Job、任务里启动的固定流程与
 *   它的子步骤都算在这个任务里（流程的子任务经父任务找到提交它的智能体任务）；
 * - `grants` 主题：授权的发放、用量与撤销。
 */

export interface GrantServiceOptions {
  file: string;
  services: ModelServices;
  log: Logger;
  now?: () => Date;
}

/** `plan` 的输入：一次模型调用的能力、Provider 与范围。 */
export interface OutboundCall {
  capability: ModelServiceCapability;
  /** 调用方给的 Provider；不给时用这种能力的有效默认值。 */
  providerId?: string | undefined;
  modelId?: string | null | undefined;
  videoId: Id | null;
  taskId: Id | null;
  dataKinds?: GrantDataKind[];
  quantity?: { count?: number; chars?: number };
  purpose: string;
  /** `purpose` 由 Runtime 写成时的引用：审批里的待批准项与发放的授权带上它，界面按当前语言重新生成。 */
  purposeRef?: MessageRef;
}

/** Runtime 写成的用途：文字与它的引用（`OutboundCall` 的 `purpose` / `purposeRef`）。 */
export function outboundPurpose(purpose: Localized): Pick<OutboundCall, 'purpose' | 'purposeRef'> {
  return { purpose: purpose.text, purposeRef: refOf(purpose) };
}

/**
 * `plan` 的结果：
 * - `none`：不需要授权（本机、节点），或解析不到 Provider、Provider 没有启用（提交时会被拒绝，数据不会外发）；
 * - `covered`：有授权覆盖、额度够；
 * - `approval`：要用户授权这次外发（`item` 放进审批）。
 * 额度不够（`BUDGET_EXCEEDED`）时直接抛出，不进审批：预算上限在任何访问模式下都生效。
 */
export type OutboundPlan =
  | { status: 'none'; kind: ProviderKind | null }
  | { status: 'covered'; kind: ProviderKind; grant: Grant }
  | { status: 'approval'; kind: ProviderKind; item: GrantRequestItem };

interface Judged {
  status: 'judged';
  provider: ProviderInfo;
  dataKinds: GrantDataKind[];
  estimate: Money | null;
  evaluation: GrantEvaluation;
}

/** 要用户批准的一项：为什么要授权按评估的结果。 */
function requestItem(call: OutboundCall, judged: Judged): GrantRequestItem {
  const { provider, dataKinds, estimate, evaluation } = judged;
  return {
    capability: call.capability,
    dataKinds,
    recipient: provider.providerId,
    videoId: call.videoId,
    purpose: call.purpose,
    ...(call.purposeRef ? { purposeRef: call.purposeRef } : {}),
    reason:
      evaluation.status === 'unverifiable'
        ? 'unverifiable'
        : evaluation.status === 'exhausted'
          ? 'exhausted'
          : evaluation.status === 'none' && evaluation.revoked
            ? 'revoked'
            : 'none',
    cost: provider.model.cost ?? 'unknown',
    estimate,
    maxCalls: null,
  };
}

interface ProviderInfo {
  providerId: string;
  kind: ProviderKind;
  label: string;
  enabled: boolean;
  model: ModelInfoBase & { cost?: ModelCost };
}

export class GrantService implements JobAdmission {
  readonly store: GrantStore;
  readonly topic: TopicLog<GrantsSnapshot, GrantsEvent>;
  readonly #services: ModelServices;
  readonly #log: Logger;
  #jobs: (() => JobRecord[]) | null = null;
  #job: ((jobId: Id) => JobRecord | null) | null = null;
  #present: (submitter: JobSubmitter) => boolean = () => false;

  private constructor(store: GrantStore, options: GrantServiceOptions) {
    this.store = store;
    this.#services = options.services;
    this.#log = options.log.child('grants');
    this.topic = new TopicLog<GrantsSnapshot, GrantsEvent>(() => ({ grants: store.list({ includeEnded: true }) }), '0');
    store.onChange((change) =>
      this.topic.publish(
        'grant' in change ? { type: 'grant.upsert', grant: change.grant } : { type: 'grant.removed', grantId: change.removed },
      ),
    );
  }

  static async open(options: GrantServiceOptions): Promise<GrantService> {
    const store = await GrantStore.open(options.file, { log: options.log.child('grants'), ...(options.now ? { now: options.now } : {}) });
    return new GrantService(store, options);
  }

  /** 任务记录的来源（用量报告列出用过授权的任务；流程的子任务经它找到所在的智能体任务）。 */
  attachJobs(jobs: () => JobRecord[], job?: (jobId: Id) => JobRecord | null): void {
    this.#jobs = jobs;
    this.#job = job ?? ((jobId) => jobs().find((r) => r.jobId === jobId) ?? null);
  }

  /**
   * 哪些提交者是在场的用户（工具页的当场授权，§7.9）：Runtime 登记桌面界面的连接。在场的用户启动流程、直接提交任务时，
   * 缺授权或额度不够的拒绝多带待批准的项（`pendingGrants`），由客户端请用户确认、发放之后重新提交；这里从不发放授权。
   * 没有设时一律不在场。
   */
  setPresence(present: (submitter: JobSubmitter) => boolean): void {
    this.#present = present;
  }

  present(submitter: JobSubmitter | undefined): boolean {
    return submitter !== undefined && this.#present(submitter);
  }

  // ---- 任务预算（§3.2、§7.8） ----

  /** 一个任务的预算与用量；没有时 null。 */
  taskBudget(taskId: Id): TaskBudgetPolicy | null {
    return this.store.taskBudget(taskId);
  }

  /** 建立或修改一个任务的预算上限。 */
  setTaskBudget(taskId: Id, limits: TaskBudgetLimits): TaskBudgetPolicy {
    return this.store.setTaskBudget(taskId, limits);
  }

  /**
   * 提交者所在的智能体任务：智能体提交的是它的任务；流程的子任务、流程里提交的 Job 经父任务往上找。其余（连接、
   * 系统、节点、对外服务）不在任务里。
   */
  taskOf(submitter: JobSubmitter): Id | null {
    let current: JobSubmitter | undefined = submitter;
    for (let depth = 0; current && depth < 8; depth++) {
      if (current.kind === 'agent') return current.taskId;
      if (current.kind !== 'pipeline') return null;
      current = this.#job?.(current.id)?.submitter;
    }
    return null;
  }

  /** 一个 Job（流程的步骤子任务）所在的智能体任务。 */
  taskOfJob(jobId: Id | null): Id | null {
    if (jobId === null) return null;
    const record = this.#job?.(jobId);
    return record ? this.taskOf(record.submitter) : null;
  }

  /** 启动时：任务账本对过账之后，剩下的预留没有任务认领（进程内调用、没来得及落盘的任务），按开始与否结算。 */
  settleOrphans(): void {
    const count = this.store.settleOrphans();
    if (count > 0) this.#log.warn('Settled outbound reservations left over from last time', { count });
  }

  // ---- 启用 Provider 时的默认授权（§6.8） ----

  /**
   * 按模型服务的配置对账：启用着的在线与智能体 Provider 各有一条默认授权（同一次启用只发放一次，用户撤销后不补发）；
   * 停用或移除的，撤销它启用时发放的默认授权。
   */
  reconcile(): void {
    const store = this.#services.store;
    const ids = new Set(store.providerIds());
    const kinds = this.#providerKinds();
    for (const providerId of ids) {
      const config = store.configView(providerId);
      if (!config.enabled) {
        if (this.store.revokeProviderGrants(providerId) > 0) this.#log.info('Provider turned off; default grant revoked', { providerId });
        continue;
      }
      const info = kinds.get(providerId);
      if (!info || info.dataKinds.length === 0) continue;
      this.store.ensureProviderGrant({
        recipient: providerId,
        dataKinds: info.dataKinds,
        enabledAt: enabledKey(config.enabledAt),
        label: info.label,
      });
    }
    for (const grant of this.store.list()) {
      if (grant.origin === 'provider-enable' && !ids.has(grant.recipient)) {
        this.store.revokeProviderGrants(grant.recipient);
        this.#log.info('Provider removed; default grant revoked', { providerId: grant.recipient });
      }
    }
  }

  /** 一次调用之前补上它的 Provider 的默认授权（视图还没算出、刚启用还没对账时）。 */
  ensureDefault(providerId: string, label: string, capability: ModelServiceCapability): void {
    const config = this.#services.store.configView(providerId);
    if (!config.enabled) return;
    const kinds = new Set(this.#providerKinds().get(providerId)?.dataKinds ?? []);
    for (const kind of PROVIDER_ENABLE_DATA_KINDS[capability]) kinds.add(kind);
    this.store.ensureProviderGrant({ recipient: providerId, dataKinds: [...kinds], enabledAt: enabledKey(config.enabledAt), label });
  }

  /** 视图里的在线与智能体 Provider：它们提供的能力推出的数据种类。 */
  #providerKinds(): Map<string, { label: string; dataKinds: GrantDataKind[] }> {
    const view = this.#services.view();
    const out = new Map<string, { label: string; dataKinds: GrantDataKind[] }>();
    for (const capability of MODEL_SERVICE_CAPABILITIES) {
      for (const provider of view[capability].providers) {
        if (provider.kind !== 'online' && provider.kind !== 'agent') continue;
        const entry = out.get(provider.providerId) ?? { label: provider.label, dataKinds: [] };
        for (const kind of PROVIDER_ENABLE_DATA_KINDS[capability]) if (!entry.dataKinds.includes(kind)) entry.dataKinds.push(kind);
        out.set(provider.providerId, entry);
      }
    }
    return out;
  }

  // ---- 工具与对外服务：审批之前的判断 ----

  /** 这次调用要不要授权、额度够不够（不预留）。额度不够时抛 `BUDGET_EXCEEDED`。 */
  plan(call: OutboundCall): OutboundPlan {
    const judged = this.#judge(call);
    if (judged.status === 'none') return judged;
    const { provider, dataKinds, evaluation } = judged;
    if (evaluation.status === 'covered') return { status: 'covered', kind: provider.kind, grant: evaluation.grant };
    if (evaluation.status === 'exhausted') {
      throw grantRpcError(evaluation, { recipient: provider.providerId, label: provider.label, dataKinds, videoId: call.videoId });
    }
    return { status: 'approval', kind: provider.kind, item: requestItem(call, judged) };
  }

  /**
   * 流程启动前的判断（工具页的当场授权，§7.9）：这次调用要用户批准的项，额度不够（`exhausted`）也算；不需要授权、已有授权
   * 覆盖时 null。不预留。任务预算不够时照样抛出：批准外发放宽不了任务预算。`taskBudget: false` 不看任务预算（流程的启动，§7.8），
   * `taskId` 仍用来匹配只属于这个任务的授权。
   */
  pending(call: OutboundCall, options: { taskBudget?: boolean } = {}): GrantRequestItem | null {
    const judged = this.#judge(call, options);
    if (judged.status === 'none' || judged.evaluation.status === 'covered') return null;
    return requestItem(call, judged);
  }

  #judge(call: OutboundCall, options: { taskBudget?: boolean } = {}): { status: 'none'; kind: ProviderKind | null } | Judged {
    const provider = this.#provider(call.capability, call.providerId, call.modelId);
    if (!provider || !provider.enabled) return { status: 'none', kind: provider?.kind ?? null };
    if (provider.kind === 'local' || provider.kind === 'node') return { status: 'none', kind: provider.kind };
    this.ensureDefault(provider.providerId, provider.label, call.capability);
    const dataKinds = call.dataKinds ?? [...CAPABILITY_DATA_KINDS[call.capability]];
    const estimate = estimateCallCost(provider.model.price, call.quantity ?? {});
    // 任务预算不够时直接拒绝，不进审批：用户批准这一次外发也放宽不了任务预算。
    const task = options.taskBudget === false ? null : this.store.evaluateTask({ taskId: call.taskId, estimate });
    if (task) throw taskBudgetRpcError(task, { recipient: provider.providerId, label: provider.label, dataKinds, videoId: call.videoId });
    const evaluation = this.store.evaluate({
      recipient: provider.providerId,
      dataKinds,
      videoId: call.videoId,
      taskId: call.taskId,
      estimate,
    });
    return { status: 'judged', provider, dataKinds, estimate, evaluation };
  }

  /**
   * 审批允许之后发放授权（§12.5）。返回这次调用要点名使用的授权（「只这一次」的，或刚发放的持续授权）。
   * - 不给 `choice` 或 `persist: false`：一条只覆盖这一次调用的授权（金额未知）；`taskId` 给了时只属于这个任务；
   * - `persist: true`：一条持续授权（默认只覆盖这个视频）；给了金额上限而这个模型估不出金额时，持续授权照样发放，
   *   这一次另用一条「只这一次」的授权（金额未知），免得这次调用以 `BUDGET_UNVERIFIABLE` 被拒。
   */
  issueForApproval(
    item: GrantRequestItem,
    choice: ApprovalGrantChoice | undefined,
    context: { approvalId: Id | null; taskId: Id | null },
  ): Grant {
    const once = () =>
      this.store.create({
        dataKinds: item.dataKinds,
        recipient: item.recipient,
        scope: { videoId: item.videoId },
        purpose: item.purpose,
        ...(item.purposeRef ? { purposeRef: item.purposeRef } : {}),
        budgetMode: 'per-call-unknown-cost',
        origin: 'approval',
        once: true,
        approvalId: context.approvalId,
        taskId: context.taskId,
      });
    if (!choice?.persist) return once();
    const budgetCap = choice.budgetCap ?? null;
    const persistent = this.store.create({
      dataKinds: item.dataKinds,
      recipient: item.recipient,
      scope: { videoId: choice.scope === 'all' ? null : item.videoId },
      purpose: item.purpose,
      ...(item.purposeRef ? { purposeRef: item.purposeRef } : {}),
      budgetMode: budgetCap ? 'estimate-cap' : 'per-call-unknown-cost',
      budgetCap,
      // 持续授权的次数上限只看用户的选择：任务申请的次数只用于只属于这个任务的授权。
      maxCalls: choice.maxCalls ?? null,
      expiresAt: choice.expiresAt ?? null,
      origin: 'approval',
      approvalId: context.approvalId,
    });
    this.#log.info('Persistent grant issued on approval', { grantId: persistent.grantId, recipient: item.recipient });
    if (budgetCap && (!item.estimate || item.estimate.currency !== budgetCap.currency)) return once();
    return persistent;
  }

  /**
   * 合并审批（`grants_request`）允许后：每一项一条只属于这个任务的授权（次数上限是请求的次数），或按用户的选择发放持续授权。
   */
  issueForTask(
    items: GrantRequestItem[],
    choice: ApprovalGrantChoice | undefined,
    context: { approvalId: Id | null; taskId: Id },
  ): Grant[] {
    return items.map((item) => {
      if (choice?.persist) return this.issueForApproval(item, choice, context);
      return this.store.create({
        dataKinds: item.dataKinds,
        recipient: item.recipient,
        scope: { videoId: item.videoId },
        purpose: item.purpose,
        ...(item.purposeRef ? { purposeRef: item.purposeRef } : {}),
        budgetMode: 'per-call-unknown-cost',
        maxCalls: item.maxCalls,
        origin: 'approval',
        approvalId: context.approvalId,
        taskId: context.taskId,
      });
    });
  }

  /**
   * 发放之后提交被拒（参数检查、模型不可用、并发下额度被占完）：这次调用没有发生，撤销只为它发放、还没用过的「只这一次」授权，
   * 免得在列表里留下一条用不上的。持续授权不动（用户选择了发放它）。
   */
  discardUnused(grantId: Id): void {
    const grant = this.store.get(grantId);
    if (!grant || !grant.once || grant.state !== 'active') return;
    if (grant.usage.calls > 0 || grant.usage.reservedCalls > 0) return;
    this.store.revoke(grantId);
  }

  /** 带着刚发放的授权提交：提交被拒时撤销没用上的「只这一次」授权（`discardUnused`），原样抛出。 */
  async submitWith<T>(hint: { grantId?: Id } | undefined, submit: () => Promise<T>): Promise<T> {
    try {
      return await submit();
    } catch (error) {
      if (hint?.grantId) this.discardUnused(hint.grantId);
      throw error;
    }
  }

  // ---- JobManager 的接纳（§7.8） ----

  admit(request: JobAdmissionRequest): JobGrantUse | null {
    if (request.providerKind === 'local' || request.providerKind === 'node') return null;
    this.ensureDefault(request.providerId, request.label, request.capability);
    const dataKinds = request.hint?.dataKinds ?? [...CAPABILITY_DATA_KINDS[request.capability]];
    const estimate = estimateCallCost(request.model.price, request.quantity);
    try {
      return this.#reserve(
        {
          recipient: request.providerId,
          dataKinds,
          videoId: request.videoId,
          taskId: this.taskOf(request.submitter),
          estimate,
          ...(request.hint?.grantId ? { grantId: request.hint.grantId } : {}),
        },
        { label: request.label, jobId: request.jobId },
      );
    } catch (error) {
      // 在场的用户直接提交（工具页的生成语音、图片、文本）：拒绝里带上这一项待批准的外发（§7.9 的当场授权）。
      const reason = approvableReason(error);
      if (reason === null || !this.present(request.submitter)) throw error;
      const purpose = RcGrants.toolPurpose({ tool: capabilityLabel(request.capability) });
      throw withPendingGrants(error, [
        {
          capability: request.capability,
          dataKinds,
          recipient: request.providerId,
          videoId: request.videoId,
          purpose: purpose.text,
          purposeRef: refOf(purpose),
          reason,
          cost: (request.model as ModelInfoBase & { cost?: ModelCost }).cost ?? 'unknown',
          estimate,
          maxCalls: null,
        },
      ]);
    }
  }

  async start(use: JobGrantUse): Promise<JobError | null> {
    const started = await this.store.start(use.reservationId);
    if (started.ok) return null;
    if (started.unsaved) {
      return { code: 'INTERNAL', ...jobMessage(RcGrants.ledgerUnsaved()), details: { grantId: use.grantId } };
    }
    // 排队期间 Provider 被停用：默认授权随之撤销，但真正的原因是 Provider 不可用（与没有授权时的错误一致）。
    const grant = started.grant;
    if (grant?.origin === 'provider-enable' && !this.#services.store.configView(grant.recipient).enabled) {
      return {
        code: 'MODEL_LOAD_FAILED',
        ...jobMessage(RcGrants.providerDisabledBeforeStart()),
        details: { providerId: grant.recipient },
      };
    }
    return grantRevokedJobError(grant);
  }

  begun(use: JobGrantUse): boolean {
    return this.store.started(use.reservationId);
  }

  retry(use: JobGrantUse, call: { providerId: string; videoId: Id | null; submitter: JobSubmitter }): JobGrantUse | JobError {
    const previous = this.settle(use, { state: 'failed' }).settled!;
    try {
      const next = this.#reserve(
        {
          recipient: call.providerId,
          dataKinds: use.dataKinds,
          videoId: call.videoId,
          taskId: this.taskOf(call.submitter),
          estimate: use.reserved.amount,
          grantId: use.grantId,
        },
        { label: call.providerId, jobId: null },
      );
      return { ...next, retries: [...(use.retries ?? []), previous] };
    } catch (error) {
      if (error instanceof RpcError) return retryBudgetJobError(error);
      throw error;
    }
  }

  settle(use: JobGrantUse, outcome: { state: JobState; reported?: Money | null }): JobGrantUse {
    const settlement = this.store.settle(
      use.reservationId,
      outcome.state === 'completed' ? { kind: 'completed', reported: outcome.reported ?? null } : { kind: 'failed' },
    );
    return { ...use, settled: settlement ?? { calls: 0, amount: null, basis: 'released', at: new Date().toISOString() } };
  }

  /** 进程内的一次调用（固定流程的逐批翻译）：判断并预留，开始，返回结束时调用的结算。不通过时抛出。 */
  async begin(
    call: GrantCall & { label: string; jobId: Id | null },
  ): Promise<(outcome: { state: JobState; reported?: Money | null }) => void> {
    // 流程步骤里的调用不知道自己的任务：经子任务找到提交流程的智能体任务，算进它的任务预算。
    const taskId = call.taskId ?? this.taskOfJob(call.jobId);
    const use = this.#reserve({ ...call, taskId }, { label: call.label, jobId: call.jobId });
    const refused = await this.start(use);
    if (refused) {
      this.settle(use, { state: 'failed' });
      throw new RpcError('forbidden', refused.message, { code: refused.code, ...(refused.details as object) });
    }
    let done = false;
    return (outcome) => {
      if (done) return;
      done = true;
      this.settle(use, outcome);
    };
  }

  /** 有授权覆盖、额度够；否则抛出对应的错误（不预留）。`taskBudget: false` 不看任务预算（同 `pending`）。 */
  assertCovered(call: GrantCall, label: string = call.recipient, options: { taskBudget?: boolean } = {}): void {
    const ctx = { recipient: call.recipient, label, dataKinds: call.dataKinds, videoId: call.videoId };
    const evaluation = this.store.evaluate(call);
    if (evaluation.status !== 'covered') throw grantRpcError(evaluation, ctx);
    if (options.taskBudget === false) return;
    const task = this.store.evaluateTask(call);
    if (task) throw taskBudgetRpcError(task, ctx);
  }

  #reserve(call: GrantCall, context: { label: string; jobId: Id | null }): JobGrantUse {
    const admission = this.store.admit(call, { jobId: context.jobId });
    if (!admission.ok) {
      const ctx: GrantErrorContext = { recipient: call.recipient, label: context.label, dataKinds: call.dataKinds, videoId: call.videoId };
      if ('task' in admission) throw taskBudgetRpcError(admission.task, ctx);
      throw grantRpcError(admission.evaluation as Exclude<typeof admission.evaluation, { status: 'covered' }>, ctx);
    }
    return useOf(admission.reservation, call.dataKinds);
  }

  // ---- 方法 ----

  list(params: { recipient?: string; videoId?: Id; includeEnded?: boolean }): { grants: Grant[] } {
    return { grants: this.store.list(params) };
  }

  create(params: GrantCreateParams): { grant: Grant } {
    const grant = this.store.create({ ...params, origin: 'user' });
    this.#log.info('Grant issued', { grantId: grant.grantId, recipient: grant.recipient, dataKinds: grant.dataKinds });
    return { grant };
  }

  update(params: GrantUpdateParams): { grant: Grant } {
    return { grant: this.store.update(params) };
  }

  revoke(grantId: Id): GrantRevokeResult {
    const result = this.store.revoke(grantId);
    this.#log.info('Grant revoked', { grantId, running: result.runningJobs.length });
    return result;
  }

  usage(grantId: Id): GrantUsageReport {
    const grant = this.store.get(grantId);
    if (!grant) throw new RpcError('not-found', RcGrants.noSuchGrant());
    const jobs = (this.#jobs?.() ?? [])
      .filter((r) => r.grant?.grantId === grantId)
      .map((r) => ({ jobId: r.jobId, state: r.state, reserved: r.grant!.reserved, settled: r.grant!.settled }));
    return { grant, jobs };
  }

  flush(): Promise<void> {
    return this.store.flush();
  }

  // ---- 内部 ----

  /** 能力视图里的 Provider 与模型（同步，用最近一次算出的视图）。 */
  #provider(capability: ModelServiceCapability, providerId: string | undefined, modelId: string | null | undefined): ProviderInfo | null {
    const view = this.#services.view()[capability];
    const id = providerId ?? view.effective?.providerId;
    if (id === undefined) return null;
    const provider = view.providers.find((p) => p.providerId === id);
    if (!provider) return null;
    const wanted = modelId ?? (providerId === undefined ? view.effective?.modelId : undefined);
    const model = (wanted !== undefined ? provider.models.find((m) => m.modelId === wanted) : undefined) ??
      provider.models.find((m) => m.default) ??
      provider.models[0] ?? { modelId: wanted ?? '', label: wanted ?? '' };
    const enabled = provider.kind === 'local' || provider.kind === 'node' || provider.config?.enabled === true;
    return { providerId: provider.providerId, kind: provider.kind, label: provider.label, enabled, model };
  }
}

/**
 * 一次启用的标识：默认授权按它只发放一次（用户撤销后不补发，重新启用才再发）。记下启用时间之前的版本里启用的 Provider
 * 没有 `enabledAt`：用固定的标识，升级后照样有默认授权，撤销之后也不会因重启而补发。
 */
const LEGACY_ENABLED_AT = 'legacy';

function enabledKey(enabledAt: string | null): string {
  return enabledAt ?? LEGACY_ENABLED_AT;
}

function useOf(reservation: GrantReservation, dataKinds: readonly GrantDataKind[]): JobGrantUse {
  return {
    grantId: reservation.grantId,
    generation: reservation.generation,
    reservationId: reservation.reservationId,
    budgetMode: reservation.budgetMode,
    dataKinds: [...dataKinds],
    reserved: { calls: 1, amount: reservation.amount },
    settled: null,
  };
}
