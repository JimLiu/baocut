import {
  RpcError,
  isCurrency,
  microsToMoney,
  moneyToMicros,
  newId,
  refOf,
  type Grant,
  type GrantBudgetMode,
  type GrantCreateParams,
  type GrantDataKind,
  type GrantOrigin,
  type GrantRevokeResult,
  type GrantScope,
  type GrantState,
  type GrantUpdateParams,
  type Id,
  type JobGrantSettlement,
  type MessageRef,
  type Money,
  type TaskBudgetLimits,
  type TaskBudgetPolicy,
} from '@baocut/protocol';
import { readJson, writeJsonAtomic } from './json-file.ts';
import { RuntimeStorageGrants as SG } from '@baocut/protocol/messages/runtime-storage';

/**
 * 数据外发的授权与预算账本（架构设计 §12.5、§7.8），文件是 `<runtime-home>/store/grants.json`（0600）。
 *
 * - 判断与预留都是同步的：同一个事件循环回合里查额度、记下预留，并行的提交不会一起越过上限。写盘在之后串行进行
 *   （写临时文件、fsync、改名、fsync 目录），崩溃时最多丢掉最后几笔预留，对应的任务也没有落盘，重启时按孤儿预留结算。
 * - 「已开始」例外：`start` 等它落盘之后才放行，数据交出之前账本里一定记着这笔预留开始了；重启后它不会被当成没开始而释放。
 * - 金额按百万分之一的整数记，不用浮点数；币种与上限不同的估算视为无法估算。
 * - 结算规则（§7.8）：还没开始执行就结束的预留全部释放；完成的按服务报告的费用计，没有报告时按预留的估算计
 *   （没有估算时只计次数、金额未知）；开始执行之后失败、取消或中断的，服务没有报告时保守地计一次调用并扣下预留的估算。
 * - 任务预算（§3.2、§7.8）：一个任务一条策略（次数与金额上限，跨 Provider 合计）。调用通过授权之后还要通过它，同一笔预留
 *   同时占用两者，开始与结算也是同一次：开始落盘一次，结算时授权与任务的用量一起记、只记一次（重启后孤儿预留同样只结算一次）。
 *   有金额上限时，估算要与上限同币种；已用里有别的币种、金额未知的调用，或预留中有估不出的，都视为无法保证上限。
 */

/** 一次调用要的授权。 */
export interface GrantCall {
  recipient: string;
  dataKinds: readonly GrantDataKind[];
  /** 外发的数据来自（或结果要放进）哪个视频；没有时 null，只有全部视频的授权覆盖它。 */
  videoId: Id | null;
  /** 调用发生在哪个任务里（会话的一次执行）；没有时 null，只属于某个任务的授权不覆盖它。 */
  taskId: Id | null;
  /** 估算的金额上界；没有价格时 null。 */
  estimate: Money | null;
  /** 只用这条授权（审批时为这一次调用发放的）。 */
  grantId?: Id;
}

export type GrantEvaluation =
  | { status: 'covered'; grant: Grant }
  /** 覆盖它的授权额度不够了：次数或金额。 */
  | { status: 'exhausted'; grant: Grant; measure: 'calls' | 'amount' }
  /** 覆盖它的授权有金额上限，但这次调用估不出金额（模型没有价格、币种不同）。 */
  | { status: 'unverifiable'; grant: Grant }
  /** 没有授权覆盖它；`revoked` 是曾经覆盖它、已经撤销或到期的那一条。 */
  | { status: 'none'; revoked: Grant | null };

/** 一笔预留。 */
export interface GrantReservation {
  reservationId: Id;
  grantId: Id;
  generation: number;
  budgetMode: GrantBudgetMode;
  amount: Money | null;
}

/** 任务预算不够（次数或金额），或有金额上限而这次调用估不出同币种的金额。 */
export type TaskBudgetRefusal =
  { status: 'exhausted'; policy: TaskBudgetPolicy; measure: 'calls' | 'amount' } | { status: 'unverifiable'; policy: TaskBudgetPolicy };

export type GrantAdmission =
  | { ok: true; reservation: GrantReservation; grant: Grant }
  | { ok: false; evaluation: GrantEvaluation }
  | { ok: false; task: TaskBudgetRefusal };

/** 结算时的结局：完成（可能带服务报告的费用），或失败、取消、中断。 */
export type GrantOutcome = { kind: 'completed'; reported?: Money | null } | { kind: 'failed' };

export interface GrantIssue extends GrantCreateParams {
  /** `purpose` 由 Runtime 写成时的文字引用（界面按当前语言重新生成）。 */
  purposeRef?: MessageRef;
  origin: GrantOrigin;
  once?: boolean;
  approvalId?: Id | null;
}

export interface GrantStoreOptions {
  now?: () => Date;
  /** 已经结束（撤销、到期、用完）的授权最多留多少条（默认 200）；还有预留的不淘汰。 */
  maxEnded?: number;
  /** 任务预算最多留多少条（默认 1000），超出时淘汰最旧的、没有预留的。 */
  maxTaskBudgets?: number;
}

interface StoredGrant {
  grantId: Id;
  dataKinds: GrantDataKind[];
  recipient: string;
  scope: GrantScope;
  purpose: string;
  purposeRef?: MessageRef;
  budgetMode: GrantBudgetMode;
  budgetCap: Money | null;
  maxCalls: number | null;
  expiresAt: string | null;
  generation: number;
  taskId: Id | null;
  once: boolean;
  origin: GrantOrigin;
  approvalId: Id | null;
  /** 启用 Provider 时默认发放的：那次启用的时间（同一次启用只发放一次，撤销之后不再自动补发）。 */
  providerEnabledAt: string | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  used: { calls: number; amountMicros: string; unknownCostCalls: number };
}

interface StoredReservation {
  reservationId: Id;
  grantId: Id;
  generation: number;
  jobId: Id | null;
  amountMicros: string | null;
  started: boolean;
  createdAt: string;
  /** 同时占用的任务预算（早先的记录没有）。 */
  taskPolicyId?: Id | null;
  /** 这次调用的估算（任何币种；没有时 null），结算任务预算用。 */
  taskEstimate?: Money | null;
}

interface StoredTaskBudget {
  policyId: Id;
  taskId: Id;
  maxCalls: number | null;
  cap: Money | null;
  /** 已结算的用量：金额按币种分列（百万分之一的整数）。 */
  used: { calls: number; amounts: Record<string, string>; unknownCostCalls: number };
  createdAt: string;
  updatedAt: string;
}

interface GrantsFile {
  schemaVersion: 1;
  grants: StoredGrant[];
  reservations: StoredReservation[];
  /** 任务预算（早先的文件没有）。 */
  taskBudgets?: StoredTaskBudget[];
}

export class GrantStore {
  readonly #file: string;
  readonly #now: () => Date;
  readonly #maxEnded: number;
  readonly #maxTaskBudgets: number;
  readonly #grants = new Map<Id, StoredGrant>();
  /** 任务预算，按任务。 */
  readonly #taskBudgets = new Map<Id, StoredTaskBudget>();
  readonly #reservations = new Map<Id, StoredReservation>();
  readonly #listeners = new Set<(change: { grant: Grant } | { removed: Id }) => void>();
  #writing: Promise<void> = Promise.resolve();
  /** 排着、还没开始的那次写：之后的变化都会被它带上。兑现为写盘的错误（成功时 null）。 */
  #queued: Promise<unknown> | null = null;
  /** 上一次写盘失败：内存里的账本比磁盘新。 */
  #unsaved = false;

  private constructor(file: string, options: GrantStoreOptions) {
    this.#file = file;
    this.#now = options.now ?? (() => new Date());
    this.#maxEnded = options.maxEnded ?? 200;
    this.#maxTaskBudgets = options.maxTaskBudgets ?? 1000;
  }

  static async open(file: string, options: GrantStoreOptions = {}): Promise<GrantStore> {
    const store = new GrantStore(file, options);
    const data = await readJson<GrantsFile>(file);
    if (data !== null) {
      if (typeof data !== 'object' || !Array.isArray(data.grants) || !Array.isArray(data.reservations)) {
        throw new Error(`Malformed grants file: ${file}`);
      }
      for (const grant of data.grants) store.#grants.set(grant.grantId, grant);
      for (const r of data.reservations) if (store.#grants.has(r.grantId)) store.#reservations.set(r.reservationId, r);
      for (const budget of Array.isArray(data.taskBudgets) ? data.taskBudgets : []) store.#taskBudgets.set(budget.taskId, budget);
    }
    return store;
  }

  // ---- 读取 ----

  list(filter: { recipient?: string; videoId?: Id; includeEnded?: boolean } = {}): Grant[] {
    return [...this.#grants.values()]
      .map((g) => this.#view(g))
      .filter((g) => (filter.includeEnded ? true : g.state === 'active'))
      .filter((g) => filter.recipient === undefined || g.recipient === filter.recipient)
      .filter((g) => filter.videoId === undefined || g.scope.videoId === null || g.scope.videoId === filter.videoId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  get(grantId: Id): Grant | null {
    const grant = this.#grants.get(grantId);
    return grant ? this.#view(grant) : null;
  }

  /** 一条授权的预留（还没结算的调用）。 */
  reservations(grantId: Id): Array<{ reservationId: Id; jobId: Id | null; started: boolean; amount: Money | null }> {
    const grant = this.#grants.get(grantId);
    return [...this.#reservations.values()]
      .filter((r) => r.grantId === grantId)
      .map((r) => ({
        reservationId: r.reservationId,
        jobId: r.jobId,
        started: r.started,
        amount:
          r.amountMicros !== null && grant?.budgetCap
            ? { amount: microsToMoney(BigInt(r.amountMicros)), currency: grant.budgetCap.currency }
            : null,
      }));
  }

  onChange(listener: (change: { grant: Grant } | { removed: Id }) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // ---- 判断与预留（同步） ----

  /** 这次调用有没有授权覆盖、额度够不够。不改任何东西。 */
  evaluate(call: GrantCall): GrantEvaluation {
    const now = this.#now();
    const candidates = [...this.#grants.values()].filter((g) => this.#matches(g, call));
    const live = candidates.filter((g) => g.revokedAt === null && !expired(g, now)).sort(preference);
    let failure: GrantEvaluation | null = null;
    for (const grant of live) {
      const fit = this.#fit(grant, call);
      if (fit === 'ok') return { status: 'covered', grant: this.#view(grant) };
      failure ??=
        fit === 'unverifiable'
          ? { status: 'unverifiable', grant: this.#view(grant) }
          : { status: 'exhausted', grant: this.#view(grant), measure: fit };
    }
    if (failure) return failure;
    const ended = candidates.filter((g) => g.revokedAt !== null || expired(g, now)).sort(byUpdatedDesc)[0];
    return { status: 'none', revoked: ended ? this.#view(ended) : null };
  }

  /** 这次调用在它的任务预算之内（不改任何东西）。不在任务里、任务没有预算、在预算之内时 null。 */
  evaluateTask(call: Pick<GrantCall, 'taskId' | 'estimate'>): TaskBudgetRefusal | null {
    const budget = call.taskId !== null ? this.#taskBudgets.get(call.taskId) : undefined;
    if (!budget) return null;
    const fit = this.#taskFit(budget, call.estimate);
    if (fit === 'ok') return null;
    return fit === 'unverifiable'
      ? { status: 'unverifiable', policy: this.#taskView(budget) }
      : { status: 'exhausted', policy: this.#taskView(budget), measure: fit };
  }

  /** 判断并预留一次调用，在同一个同步调用里完成（§7.8 的原子预留）：先授权，再任务预算；同一笔预留占用两者。 */
  admit(call: GrantCall, options: { jobId?: Id | null } = {}): GrantAdmission {
    const evaluation = this.evaluate(call);
    if (evaluation.status !== 'covered') return { ok: false, evaluation };
    const task = this.evaluateTask(call);
    if (task) return { ok: false, task };
    const grant = this.#grants.get(evaluation.grant.grantId)!;
    const amountMicros = grant.budgetCap && call.estimate ? moneyToMicros(call.estimate.amount).toString() : null;
    const budget = call.taskId !== null ? this.#taskBudgets.get(call.taskId) : undefined;
    const reservation: StoredReservation = {
      reservationId: newId('grs'),
      grantId: grant.grantId,
      generation: grant.generation,
      jobId: options.jobId ?? null,
      amountMicros,
      started: false,
      createdAt: this.#now().toISOString(),
      ...(budget ? { taskPolicyId: budget.policyId, taskEstimate: call.estimate } : {}),
    };
    this.#reservations.set(reservation.reservationId, reservation);
    this.#changed(grant);
    return { ok: true, reservation: this.#ticket(reservation, grant), grant: this.#view(grant) };
  }

  /**
   * 预留的调用要开始执行（数据即将交出）：授权还有效、代没有变时记为已开始，**落盘之后**才兑现 `ok`（§7.8）。
   * 授权撤销、到期或被收紧（代变了）时返回那条授权，调用方以 `GRANT_REVOKED` 结束这次调用并释放预留。
   * 写不进磁盘时撤回「已开始」、返回 `unsaved`：调用方不发请求（否则重启后它会被当成没开始而释放）。
   */
  async start(reservationId: Id): Promise<{ ok: true } | { ok: false; grant: Grant | null; unsaved?: true }> {
    const reservation = this.#reservations.get(reservationId);
    if (!reservation) return { ok: false, grant: null };
    const grant = this.#grants.get(reservation.grantId);
    if (!grant) return { ok: false, grant: null };
    if (grant.revokedAt !== null || grant.generation !== reservation.generation || expired(grant, this.#now())) {
      return { ok: false, grant: this.#view(grant) };
    }
    if (!reservation.started) {
      reservation.started = true;
      const error = await this.#schedule();
      if (error) {
        reservation.started = false;
        void this.#schedule();
        return { ok: false, grant: this.#view(grant), unsaved: true };
      }
    }
    return { ok: true };
  }

  /** 预留还在、已经记为开始执行。 */
  started(reservationId: Id): boolean {
    return this.#reservations.get(reservationId)?.started === true;
  }

  /** 预留还在、还没开始执行。 */
  pending(reservationId: Id): boolean {
    const reservation = this.#reservations.get(reservationId);
    return reservation !== undefined && !reservation.started;
  }

  /** 结算一笔预留（见文件开头的规则）。已经结算过的返回 null。 */
  settle(reservationId: Id, outcome: GrantOutcome): JobGrantSettlement | null {
    const reservation = this.#reservations.get(reservationId);
    if (!reservation) return null;
    this.#reservations.delete(reservationId);
    this.#chargeTask(reservation, outcome);
    const grant = this.#grants.get(reservation.grantId);
    const at = this.#now().toISOString();
    if (!grant) return { calls: 0, amount: null, basis: 'released', at };
    let settlement: JobGrantSettlement;
    if (!reservation.started) {
      settlement = { calls: 0, amount: null, basis: 'released', at };
    } else {
      const currency = grant.budgetCap?.currency ?? null;
      const estimate = reservation.amountMicros !== null ? BigInt(reservation.amountMicros) : null;
      const reported = outcome.kind === 'completed' ? (outcome.reported ?? null) : null;
      let micros: bigint | null;
      let basis: JobGrantSettlement['basis'];
      if (reported && isCurrency(reported.currency) && (currency === null || reported.currency === currency)) {
        micros = currency === null ? null : moneyToMicros(reported.amount);
        basis = 'reported';
      } else if (outcome.kind === 'completed') {
        micros = estimate;
        basis = estimate !== null ? 'estimate' : 'unknown';
      } else {
        micros = estimate;
        basis = 'conservative';
      }
      grant.used.calls += 1;
      if (micros !== null) grant.used.amountMicros = (BigInt(grant.used.amountMicros) + micros).toString();
      else if (basis !== 'reported') grant.used.unknownCostCalls += 1;
      const amount =
        basis === 'reported' && reported
          ? reported
          : micros !== null && currency !== null
            ? { amount: microsToMoney(micros), currency }
            : null;
      settlement = { calls: 1, amount, basis, at };
      grant.updatedAt = at;
    }
    this.#changed(grant);
    return settlement;
  }

  /**
   * 结算没有任务认领的预留（Runtime 重启之后：进程内的调用、没来得及落盘的任务）。开始执行过的保守扣除，
   * 没开始的释放。`keep` 返回 true 的留着。返回结算的笔数。
   */
  settleOrphans(keep: (reservation: { reservationId: Id; jobId: Id | null }) => boolean = () => false): number {
    let count = 0;
    for (const reservation of [...this.#reservations.values()]) {
      if (keep({ reservationId: reservation.reservationId, jobId: reservation.jobId })) continue;
      this.settle(reservation.reservationId, { kind: 'failed' });
      count++;
    }
    return count;
  }

  // ---- 发放、修改与撤销 ----

  create(input: GrantIssue): Grant {
    const now = this.#now().toISOString();
    if ((input.budgetMode as GrantBudgetMode) === 'free-local') throw new RpcError('invalid-request', SG.localNeedsNoGrant());
    if (input.dataKinds.length === 0) throw new RpcError('invalid-request', SG.dataKindRequired());
    const budgetCap = input.budgetCap ?? null;
    if (input.budgetMode === 'estimate-cap' && budgetCap === null) throw new RpcError('invalid-request', SG.budgetCapRequired());
    if (input.budgetMode === 'per-call-unknown-cost' && budgetCap !== null) {
      throw new RpcError('invalid-request', SG.unknownCostNoCap());
    }
    if (budgetCap) moneyToMicrosOrThrow(budgetCap);
    if (input.expiresAt && Date.parse(input.expiresAt) <= this.#now().getTime()) throw new RpcError('invalid-request', SG.expiryPassed());
    const grant: StoredGrant = {
      grantId: newId('grant'),
      dataKinds: [...new Set(input.dataKinds)],
      recipient: input.recipient,
      scope: { videoId: input.scope?.videoId ?? null },
      purpose: input.purpose,
      ...(input.purposeRef ? { purposeRef: input.purposeRef } : {}),
      budgetMode: input.budgetMode,
      budgetCap,
      maxCalls: input.once ? 1 : (input.maxCalls ?? null),
      expiresAt: input.expiresAt ?? null,
      generation: 1,
      taskId: input.taskId ?? null,
      once: input.once ?? false,
      origin: input.origin,
      approvalId: input.approvalId ?? null,
      providerEnabledAt: null,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
      used: { calls: 0, amountMicros: '0', unknownCostCalls: 0 },
    };
    this.#grants.set(grant.grantId, grant);
    this.#prune();
    this.#changed(grant);
    return this.#view(grant);
  }

  /** 改一条授权：给出的字段替换。收紧（数据种类变少、范围变窄、上限降低或新设、到期提前或新设）时代加一。 */
  update(params: GrantUpdateParams): Grant {
    const grant = this.#grants.get(params.grantId);
    if (!grant) throw new RpcError('not-found', SG.grantNotFound());
    if (grant.revokedAt !== null) throw new RpcError('conflict', SG.grantRevoked());
    const next: StoredGrant = structuredClone(grant);
    if (params.dataKinds !== undefined) {
      if (params.dataKinds.length === 0) throw new RpcError('invalid-request', SG.dataKindRequired());
      next.dataKinds = [...new Set(params.dataKinds)];
    }
    if (params.scope !== undefined) next.scope = { videoId: params.scope.videoId };
    if (params.purpose !== undefined) {
      next.purpose = params.purpose;
      delete next.purposeRef;
    }
    if (params.budgetCap !== undefined) {
      if (params.budgetCap === null && grant.budgetMode === 'estimate-cap') {
        throw new RpcError('invalid-request', SG.cannotRemoveCap());
      }
      if (params.budgetCap !== null && grant.budgetMode !== 'estimate-cap') {
        throw new RpcError('invalid-request', SG.unknownCostCannotCap());
      }
      if (params.budgetCap) {
        moneyToMicrosOrThrow(params.budgetCap);
        if (grant.budgetCap && params.budgetCap.currency !== grant.budgetCap.currency) throw new RpcError('invalid-request', SG.cannotChangeCurrency());
      }
      next.budgetCap = params.budgetCap;
    }
    if (params.maxCalls !== undefined) next.maxCalls = params.maxCalls;
    if (params.expiresAt !== undefined) {
      if (params.expiresAt !== null && Date.parse(params.expiresAt) <= this.#now().getTime()) {
        throw new RpcError('invalid-request', SG.expiryPassedRevoke());
      }
      next.expiresAt = params.expiresAt;
    }
    if (tightened(grant, next)) next.generation = grant.generation + 1;
    next.updatedAt = this.#now().toISOString();
    this.#grants.set(next.grantId, next);
    this.#changed(next);
    return this.#view(next);
  }

  /** 撤销：之后不再覆盖新的调用；代加一，按旧代预留、还没开始执行的调用在开始时被拒绝。重复撤销不再加代。 */
  revoke(grantId: Id): GrantRevokeResult {
    const grant = this.#grants.get(grantId);
    if (!grant) throw new RpcError('not-found', SG.grantNotFound());
    if (grant.revokedAt === null) {
      const now = this.#now().toISOString();
      grant.revokedAt = now;
      grant.updatedAt = now;
      grant.generation += 1;
      this.#changed(grant);
    }
    const view = this.#view(grant);
    const runningJobs = [...this.#reservations.values()]
      .filter((r) => r.grantId === grantId && r.started && r.jobId !== null)
      .map((r) => r.jobId!);
    return {
      grant: view,
      alreadySent: {
        calls: grant.used.calls,
        amount: grant.budgetCap ? { amount: microsToMoney(BigInt(grant.used.amountMicros)), currency: grant.budgetCap.currency } : null,
        unknownCostCalls: grant.used.unknownCostCalls,
      },
      runningJobs,
      note: SG.revokeNote().text,
      noteRef: refOf(SG.revokeNote()),
    };
  }

  // ---- 任务预算（§3.2、§7.8） ----

  /** 一个任务的预算：没有时 null。 */
  taskBudget(taskId: Id): TaskBudgetPolicy | null {
    const budget = this.#taskBudgets.get(taskId);
    return budget ? this.#taskView(budget) : null;
  }

  /**
   * 建立或修改一个任务的预算上限（`null` 不设这一项）。用量不变：调低到已用之下时，之后的调用被拒绝，已经预留的照常结算。
   */
  setTaskBudget(taskId: Id, limits: TaskBudgetLimits): TaskBudgetPolicy {
    if (limits.maxCalls !== null && (!Number.isInteger(limits.maxCalls) || limits.maxCalls <= 0)) {
      throw new RpcError('invalid-request', SG.taskCallLimit());
    }
    if (limits.cap) moneyToMicrosOrThrow(limits.cap);
    const now = this.#now().toISOString();
    const existing = this.#taskBudgets.get(taskId);
    const budget: StoredTaskBudget = existing
      ? { ...existing, maxCalls: limits.maxCalls, cap: limits.cap, updatedAt: now }
      : {
          policyId: newId('tbp'),
          taskId,
          maxCalls: limits.maxCalls,
          cap: limits.cap,
          used: { calls: 0, amounts: {}, unknownCostCalls: 0 },
          createdAt: now,
          updatedAt: now,
        };
    this.#taskBudgets.set(taskId, budget);
    this.#pruneTaskBudgets();
    void this.#schedule();
    return this.#taskView(budget);
  }

  // ---- 启用 Provider 时的默认授权（§6.8 的迁移规则） ----

  /**
   * 启用一个在线或智能体 Provider 时发放的默认授权：数据种类由它的能力推出，不设金额上限，按次计、金额未知。
   * 同一次启用（`enabledAt`）只发放一次：用户撤销之后不再自动补发，重新启用才会。能力变了时补上新的数据种类（放宽，不加代）。
   */
  ensureProviderGrant(input: { recipient: string; dataKinds: readonly GrantDataKind[]; enabledAt: string; label: string }): Grant | null {
    if (input.dataKinds.length === 0) return null;
    const existing = [...this.#grants.values()].find(
      (g) => g.origin === 'provider-enable' && g.recipient === input.recipient && g.providerEnabledAt === input.enabledAt,
    );
    if (existing) {
      if (existing.revokedAt !== null) return null;
      const missing = input.dataKinds.filter((k) => !existing.dataKinds.includes(k));
      if (missing.length > 0) {
        existing.dataKinds = [...existing.dataKinds, ...missing];
        existing.updatedAt = this.#now().toISOString();
        this.#changed(existing);
      }
      return this.#view(existing);
    }
    const purpose = SG.providerGrantPurpose({ label: input.label });
    const created = this.create({
      dataKinds: [...input.dataKinds],
      recipient: input.recipient,
      purpose: purpose.text,
      purposeRef: refOf(purpose),
      budgetMode: 'per-call-unknown-cost',
      origin: 'provider-enable',
    });
    const stored = this.#grants.get(created.grantId)!;
    stored.providerEnabledAt = input.enabledAt;
    void this.#schedule();
    return this.#view(stored);
  }

  /** 停用或移除一个 Provider：撤销启用时默认发放的授权（用户自己发放的不动）。返回撤销的条数。 */
  revokeProviderGrants(recipient: string): number {
    let count = 0;
    for (const grant of this.#grants.values()) {
      if (grant.origin !== 'provider-enable' || grant.recipient !== recipient || grant.revokedAt !== null) continue;
      this.revoke(grant.grantId);
      count++;
    }
    return count;
  }

  /** 等待写盘完成；上一次写失败时再写一次（还写不进去就算了，不无限重试）。 */
  async flush(): Promise<void> {
    await this.#writing;
    if (this.#unsaved) await this.#schedule();
  }

  // ---- 内部 ----

  #matches(grant: StoredGrant, call: GrantCall): boolean {
    if (call.grantId !== undefined) {
      if (grant.grantId !== call.grantId) return false;
    } else if (grant.once) {
      return false;
    }
    if (grant.recipient !== call.recipient) return false;
    if (!call.dataKinds.every((k) => grant.dataKinds.includes(k))) return false;
    if (grant.scope.videoId !== null && grant.scope.videoId !== call.videoId) return false;
    if (grant.taskId !== null && grant.taskId !== call.taskId) return false;
    return true;
  }

  #fit(grant: StoredGrant, call: GrantCall): 'ok' | 'calls' | 'amount' | 'unverifiable' {
    const reserved = [...this.#reservations.values()].filter((r) => r.grantId === grant.grantId);
    if (grant.maxCalls !== null && grant.used.calls + reserved.length + 1 > grant.maxCalls) return 'calls';
    if (grant.budgetMode !== 'estimate-cap' || grant.budgetCap === null) return 'ok';
    if (!call.estimate || call.estimate.currency !== grant.budgetCap.currency) return 'unverifiable';
    const reservedMicros = reserved.reduce((sum, r) => sum + (r.amountMicros !== null ? BigInt(r.amountMicros) : 0n), 0n);
    const total = BigInt(grant.used.amountMicros) + reservedMicros + moneyToMicros(call.estimate.amount);
    return total > moneyToMicros(grant.budgetCap.amount) ? 'amount' : 'ok';
  }

  #taskFit(budget: StoredTaskBudget, estimate: Money | null): 'ok' | 'calls' | 'amount' | 'unverifiable' {
    const reserved = [...this.#reservations.values()].filter((r) => r.taskPolicyId === budget.policyId);
    if (budget.maxCalls !== null && budget.used.calls + reserved.length + 1 > budget.maxCalls) return 'calls';
    if (budget.cap === null) return 'ok';
    const currency = budget.cap.currency;
    if (!estimate || estimate.currency !== currency) return 'unverifiable';
    const foreign = Object.entries(budget.used.amounts).some(([c, micros]) => c !== currency && BigInt(micros) > 0n);
    if (foreign || budget.used.unknownCostCalls > 0) return 'unverifiable';
    if (reserved.some((r) => !r.taskEstimate || r.taskEstimate.currency !== currency)) return 'unverifiable';
    const reservedMicros = reserved.reduce((sum, r) => sum + moneyToMicros(r.taskEstimate!.amount), 0n);
    const total = BigInt(budget.used.amounts[currency] ?? '0') + reservedMicros + moneyToMicros(estimate.amount);
    return total > moneyToMicros(budget.cap.amount) ? 'amount' : 'ok';
  }

  /** 结算时记进任务预算（与授权的结算同一次）：开始过的计一次调用，金额按报告、估算或保守的估算，都没有时记为金额未知。 */
  #chargeTask(reservation: StoredReservation, outcome: GrantOutcome): void {
    if (!reservation.taskPolicyId || !reservation.started) return;
    const budget = [...this.#taskBudgets.values()].find((b) => b.policyId === reservation.taskPolicyId);
    if (!budget) return;
    const reported = outcome.kind === 'completed' ? (outcome.reported ?? null) : null;
    const amount = reported && isCurrency(reported.currency) ? reported : (reservation.taskEstimate ?? null);
    budget.used.calls += 1;
    if (amount) {
      const before = BigInt(budget.used.amounts[amount.currency] ?? '0');
      budget.used.amounts[amount.currency] = (before + moneyToMicros(amount.amount)).toString();
    } else {
      budget.used.unknownCostCalls += 1;
    }
    budget.updatedAt = this.#now().toISOString();
  }

  #taskView(budget: StoredTaskBudget): TaskBudgetPolicy {
    const reserved = [...this.#reservations.values()].filter((r) => r.taskPolicyId === budget.policyId);
    const reservedByCurrency = new Map<string, bigint>();
    for (const r of reserved) {
      if (!r.taskEstimate) continue;
      const before = reservedByCurrency.get(r.taskEstimate.currency) ?? 0n;
      reservedByCurrency.set(r.taskEstimate.currency, before + moneyToMicros(r.taskEstimate.amount));
    }
    return structuredClone({
      policyId: budget.policyId,
      taskId: budget.taskId,
      maxCalls: budget.maxCalls,
      cap: budget.cap,
      usage: {
        calls: budget.used.calls,
        reservedCalls: reserved.length,
        spent: Object.entries(budget.used.amounts).map(([currency, micros]) => ({ amount: microsToMoney(BigInt(micros)), currency })),
        reserved: [...reservedByCurrency].map(([currency, micros]) => ({ amount: microsToMoney(micros), currency })),
        unknownCostCalls: budget.used.unknownCostCalls,
      },
      createdAt: budget.createdAt,
      updatedAt: budget.updatedAt,
    } satisfies TaskBudgetPolicy);
  }

  /** 淘汰最旧的任务预算（还有预留的不动）。 */
  #pruneTaskBudgets(): void {
    if (this.#taskBudgets.size <= this.#maxTaskBudgets) return;
    const busy = new Set([...this.#reservations.values()].map((r) => r.taskPolicyId).filter((id): id is Id => !!id));
    const idle = [...this.#taskBudgets.values()]
      .filter((b) => !busy.has(b.policyId))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0));
    for (const budget of idle.slice(0, this.#taskBudgets.size - this.#maxTaskBudgets)) this.#taskBudgets.delete(budget.taskId);
  }

  #ticket(reservation: StoredReservation, grant: StoredGrant): GrantReservation {
    return {
      reservationId: reservation.reservationId,
      grantId: grant.grantId,
      generation: reservation.generation,
      budgetMode: grant.budgetMode,
      amount:
        reservation.amountMicros !== null && grant.budgetCap
          ? { amount: microsToMoney(BigInt(reservation.amountMicros)), currency: grant.budgetCap.currency }
          : null,
    };
  }

  #state(grant: StoredGrant, reservedCalls: number): GrantState {
    if (grant.revokedAt !== null) return 'revoked';
    if (expired(grant, this.#now())) return 'expired';
    if (grant.maxCalls !== null && grant.used.calls >= grant.maxCalls && reservedCalls === 0) return 'exhausted';
    if (grant.budgetCap && BigInt(grant.used.amountMicros) >= moneyToMicros(grant.budgetCap.amount) && reservedCalls === 0)
      return 'exhausted';
    return 'active';
  }

  #view(grant: StoredGrant): Grant {
    const reserved = [...this.#reservations.values()].filter((r) => r.grantId === grant.grantId);
    const currency = grant.budgetCap?.currency ?? null;
    const reservedMicros = reserved.reduce((sum, r) => sum + (r.amountMicros !== null ? BigInt(r.amountMicros) : 0n), 0n);
    return structuredClone({
      grantId: grant.grantId,
      dataKinds: grant.dataKinds,
      recipient: grant.recipient,
      scope: grant.scope,
      purpose: grant.purpose,
      ...(grant.purposeRef ? { purposeRef: grant.purposeRef } : {}),
      budgetMode: grant.budgetMode,
      budgetCap: grant.budgetCap,
      maxCalls: grant.maxCalls,
      expiresAt: grant.expiresAt,
      generation: grant.generation,
      taskId: grant.taskId,
      once: grant.once,
      origin: grant.origin,
      approvalId: grant.approvalId,
      state: this.#state(grant, reserved.length),
      createdAt: grant.createdAt,
      updatedAt: grant.updatedAt,
      revokedAt: grant.revokedAt,
      usage: {
        calls: grant.used.calls,
        reservedCalls: reserved.length,
        amount: currency !== null ? microsToMoney(BigInt(grant.used.amountMicros)) : null,
        reservedAmount: currency !== null ? microsToMoney(reservedMicros) : null,
        unknownCostCalls: grant.used.unknownCostCalls,
      },
    } satisfies Grant);
  }

  /** 淘汰最旧的已结束授权（还有预留的不动）。 */
  #prune(): void {
    const ended = [...this.#grants.values()]
      .filter((g) => this.#state(g, 0) !== 'active' && ![...this.#reservations.values()].some((r) => r.grantId === g.grantId))
      .sort(byUpdatedDesc);
    for (const grant of ended.slice(this.#maxEnded)) {
      this.#grants.delete(grant.grantId);
      for (const listener of this.#listeners) safe(() => listener({ removed: grant.grantId }));
    }
  }

  #changed(grant: StoredGrant): void {
    void this.#schedule();
    const view = this.#view(grant);
    for (const listener of this.#listeners) safe(() => listener({ grant: structuredClone(view) }));
  }

  /** 排一次写盘（已经有一次排着时并进它）。兑现为这次写盘的错误，成功时 null。 */
  #schedule(): Promise<unknown> {
    if (this.#queued) return this.#queued;
    const write = this.#writing.then(async () => {
      // 从这里起的变化要再排一次。
      this.#queued = null;
      const file: GrantsFile = {
        schemaVersion: 1,
        grants: [...this.#grants.values()],
        reservations: [...this.#reservations.values()],
        taskBudgets: [...this.#taskBudgets.values()],
      };
      try {
        await writeJsonAtomic(this.#file, file, { mode: 0o600, durable: true });
        this.#unsaved = false;
        return null;
      } catch (error) {
        // 写盘失败时内存里的账本照常生效；下一次变化或 flush 再写。
        this.#unsaved = true;
        return error;
      }
    });
    this.#queued = write;
    this.#writing = write.then(() => {});
    return write;
  }
}

function expired(grant: StoredGrant, now: Date): boolean {
  return grant.expiresAt !== null && Date.parse(grant.expiresAt) <= now.getTime();
}

/** 优先用最具体的授权：属于这个任务的，其次只覆盖这个视频的，再次全部视频的；同级新的在前。 */
function preference(a: StoredGrant, b: StoredGrant): number {
  const rank = (g: StoredGrant) => (g.taskId !== null ? 0 : g.scope.videoId !== null ? 1 : 2);
  return rank(a) - rank(b) || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);
}

function byUpdatedDesc(a: StoredGrant, b: StoredGrant): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
}

/** 收紧：同样的调用在新的授权下可能不再被覆盖。 */
function tightened(before: StoredGrant, after: StoredGrant): boolean {
  if (before.dataKinds.some((k) => !after.dataKinds.includes(k))) return true;
  if (before.scope.videoId !== after.scope.videoId && after.scope.videoId !== null) return true;
  if (after.maxCalls !== null && (before.maxCalls === null || after.maxCalls < before.maxCalls)) return true;
  if (after.budgetCap && before.budgetCap && moneyToMicros(after.budgetCap.amount) < moneyToMicros(before.budgetCap.amount)) return true;
  if (after.expiresAt !== null && (before.expiresAt === null || Date.parse(after.expiresAt) < Date.parse(before.expiresAt))) return true;
  return false;
}

function moneyToMicrosOrThrow(money: Money): bigint {
  if (!isCurrency(money.currency)) throw new RpcError('invalid-request', SG.invalidCurrency({ currency: money.currency }));
  try {
    return moneyToMicros(money.amount);
  } catch (error) {
    throw new RpcError('invalid-request', (error as Error).message);
  }
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // 订阅方的错误不影响账本。
  }
}
