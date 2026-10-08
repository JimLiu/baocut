import { randomUUID } from 'node:crypto';
import {
  RESOURCE_DIMENSIONS,
  type JobWait,
  type ResourceAmounts,
  type ResourceCapacity,
  type ResourceDemand,
  type ResourceDimension,
  type ResourceLeaseView,
  type ResourcePriority,
  type ResourcesSnapshot,
  live,
  type Localized,
} from '@baocut/protocol';
import { JobsResourceScheduler as J } from '@baocut/protocol/messages/jobs/resource-scheduler.ts';
import { LocalizedError, textParts } from './job-text.ts';
import { silentLog, type JobsLogger } from './jobs-logger.ts';
import { MachineCapacity, type CapacitySource } from './machine-capacity.ts';
import { defaultReserves, type ResourceReserves } from './resource-profiles.ts';

/**
 * 资源调度（架构设计 §7.6、§7.7）：重的本机工作先按峰值需求准入，拿到租约才开始，结束后归还。
 *
 * - **并发队列**：每项工作可以属于一个队列（同一个模型包、同一个在线 Provider……），同一队列按先后、不超过它的并发上限。
 *   这就是原来 JobManager 的按队列并发，现在是调度的一个约束，不是另一套系统。在线 Provider 的调用只有这一个约束。
 * - **峰值准入**：需求按维度（内存、GPU 内存、CPU 线程、staging 磁盘）计，放得下才开始；放不下时排队并记下在等什么。
 *   单个需求比这台机器能给的还大时直接拒绝（`RESOURCE_ADMISSION_UNSATISFIABLE`），不无限等。
 * - **不插队**：在等某些维度的工作挡住后来的、也要这些维度的工作；后来的只在不碰这些维度时可以先开始。
 * - **交互优先**：`interactive` 的排在 `background` 前面，并且可以用交互预留；后台工作不能吃掉交互预留。
 *   不抢占正在执行的工作（§7.6「不假定可以强行抢占」）。
 * - **共用的常驻进程（holder）**：一个模型包的 Model Worker 被几个任务先后使用，量只计一次。任务的租约与进程各持有一份：
 *   任务结束后进程还在时照样计入，进程真的退出（或模型卸载）后才归还（§7.7「发出释放请求不等于资源已经归还」）。
 *   空闲的 holder 在有工作等它占着的资源时按最久未用先驱逐。
 */

export interface ResourceRequest {
  /** 任务的 `jobId`。 */
  owner: string;
  /** 给人看的种类。 */
  label: string;
  priority?: ResourcePriority;
  queue?: { key: string; concurrency: number } | null;
  /** 这项工作自己的峰值需求。 */
  demand?: ResourceDemand;
  /** 用到的共用 holder：还没有时连同它的量一起准入，已经有时不再计。 */
  holder?: { id: string; demand: ResourceDemand } | null;
}

export interface ResourceLease {
  readonly leaseId: string;
  /** 归还（幂等）。只在资源真的放下之后调用。 */
  release(): void;
}

export interface ResourceTicket {
  /** 撤回还在等的请求（已经准入或拒绝时什么也不做）。 */
  withdraw(): void;
}

export interface ResourceHandlers {
  /** 准入：同步调用，拿到租约。 */
  admit(lease: ResourceLease): void;
  /** 需求超过这台机器能给的量，永远放不下。 */
  reject(error: ResourceExceedsCapacity): void;
  /** 在等什么变了（null：不再等，马上准入）。 */
  wait?(wait: JobWait | null): void;
}

/** 超过容量的维度：需求与这个优先级最多能用的量。 */
export interface ExceededDimension {
  dimension: ResourceDimension;
  demand: number;
  limit: number;
}

export class ResourceExceedsCapacity extends LocalizedError {
  readonly code = 'RESOURCE_ADMISSION_UNSATISFIABLE';
  readonly dimensions: ExceededDimension[];

  constructor(dimensions: ExceededDimension[]) {
    super(J.exceedsCapacity({ dimensions: dimensions.map((d) => d.dimension).join(',') }));
    this.name = 'ResourceExceedsCapacity';
    this.dimensions = dimensions;
  }
}

export interface ResourceSchedulerOptions {
  /** 容量来源；不给时按本机（不含磁盘）。 */
  capacity?: CapacitySource;
  /** 预留；不给时按 `defaultReserves`。 */
  reserves?: (capacity: ResourceCapacity) => ResourceReserves;
  /** 磁盘等会变的容量多久刷新一次（默认 2 秒，只在有准入或归还时刷新）。 */
  refreshMs?: number;
  log?: JobsLogger;
}

export const DIMENSION_LABELS: Readonly<Record<ResourceDimension, string>> = live(() => ({
  memory: J.dimensionMemory().text,
  gpuMemory: J.dimensionGpuMemory().text,
  cpuThreads: J.dimensionCpuThreads().text,
  scratchDisk: J.dimensionScratchDisk().text,
}));

interface Waiter {
  seq: number;
  request: ResourceRequest;
  handlers: ResourceHandlers;
  wait: JobWait | null;
}

interface Lease {
  leaseId: string;
  request: ResourceRequest;
  priority: ResourcePriority;
  since: string;
  released: boolean;
}

interface Holder {
  id: string;
  demand: ResourceDemand;
  users: number;
  processes: number;
  since: string;
  lastUsed: number;
  evict: (() => void) | null;
  evicting: boolean;
}

type Amounts = Record<ResourceDimension, number>;

const ZERO: Amounts = { memory: 0, gpuMemory: 0, cpuThreads: 0, scratchDisk: 0 };

export class ResourceScheduler {
  readonly #capacity: CapacitySource;
  readonly #reserves: (capacity: ResourceCapacity) => ResourceReserves;
  readonly #refreshMs: number;
  readonly #log: JobsLogger;
  readonly #waiters: Waiter[] = [];
  readonly #leases = new Map<string, Lease>();
  readonly #holders = new Map<string, Holder>();
  /** 每个队列正在运行的租约数与并发上限（最近一次请求给的）。 */
  readonly #queues = new Map<string, { concurrency: number; running: number }>();
  #seq = 0;
  #pumping = false;
  #again = false;
  #refreshing = false;
  #refreshedAt = -Infinity;
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 上次探测磁盘以来租出的磁盘量的峰值：探测到的可用空间可能已经扣掉了这些租约写下的文件，它们归还之后、下次探测之前，
   * 判断「永远放不下」时仍按这个量加回去，免得拿过时的可用空间误拒。
   */
  #diskPeak = 0;

  constructor(options: ResourceSchedulerOptions = {}) {
    this.#capacity = options.capacity ?? new MachineCapacity();
    this.#reserves = options.reserves ?? defaultReserves;
    this.#refreshMs = options.refreshMs ?? 2_000;
    this.#log = options.log ?? silentLog;
  }

  /** 排队请求：放得下时同步准入（`admit` 在返回之前调用）。 */
  request(request: ResourceRequest, handlers: ResourceHandlers): ResourceTicket {
    const waiter: Waiter = { seq: ++this.#seq, request, handlers, wait: null };
    this.#waiters.push(waiter);
    this.#pump();
    return {
      withdraw: () => {
        const index = this.#waiters.indexOf(waiter);
        if (index < 0) return;
        this.#waiters.splice(index, 1);
        this.#pump();
      },
    };
  }

  /** `request` 的 Promise 写法：中止时撤回并以中止的原因拒绝，超过容量时以 `ResourceExceedsCapacity` 拒绝。 */
  acquire(
    request: ResourceRequest,
    options: { signal?: AbortSignal; onWait?: (wait: JobWait | null) => void } = {},
  ): Promise<ResourceLease> {
    const { signal, onWait } = options;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        ticket.withdraw();
        reject(signal!.reason);
      };
      const ticket = this.request(request, {
        admit: (lease) => {
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          resolve(lease);
        },
        reject: (error) => {
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
        ...(onWait ? { wait: onWait } : {}),
      });
      if (!settled) signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** 提交时的检查：这项需求在这台机器上是否永远放不下（不算现在已经租出的）。 */
  check(request: ResourceRequest): ResourceExceedsCapacity | null {
    const capacity = this.#capacity.current();
    const exceeded = this.#exceeded(this.#additional(request, capacity), request.priority ?? 'background', capacity);
    return exceeded.length > 0 ? new ResourceExceedsCapacity(exceeded) : null;
  }

  /**
   * 常驻进程持有 holder 的一份（例如启动 Model Worker 时）：进程真的退出后调用返回的函数归还。holder 不存在时（没有经过
   * 调度的使用）返回 null。`evict` 是空闲时被要求让位的办法（例如卸载模型包）：它只发出请求，真正归还仍然等进程退出。
   */
  retain(holderId: string, evict?: () => void): (() => void) | null {
    const holder = this.#holders.get(holderId);
    if (!holder) return null;
    holder.processes++;
    if (evict) holder.evict = evict;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holder.processes--;
      this.#dropIfUnused(holder);
      this.#pump();
    };
  }

  /** 容量或预留可能变了（改了设置）：重新看一遍排队的工作。 */
  recheck(): void {
    this.#refreshedAt = -Infinity;
    this.#pump();
  }

  /** 现在的租约数加上 holder 数（测试用：全部归还后为 0）。 */
  get outstanding(): number {
    return this.#leases.size + this.#holders.size;
  }

  snapshot(): ResourcesSnapshot {
    const capacity = this.#capacity.current();
    const reserves = this.#reserves(capacity);
    const leased = this.#leased(capacity);
    const view = (amounts: Amounts): ResourceAmounts => ({
      memory: amounts.memory,
      gpuMemory: capacity.gpuMemory === null ? null : amounts.gpuMemory,
      cpuThreads: amounts.cpuThreads,
      scratchDisk: capacity.scratchDisk === null ? null : amounts.scratchDisk,
    });
    const available = (priority: ResourcePriority): ResourceAmounts => {
      const line = this.#line(priority, capacity, reserves);
      const left = {} as Amounts;
      for (const d of RESOURCE_DIMENSIONS) left[d] = Math.max(0, line[d] - leased[d]);
      return view(left);
    };
    const leases: ResourceLeaseView[] = [...this.#leases.values()].map((lease) => ({
      leaseId: lease.leaseId,
      owner: lease.request.owner,
      label: lease.request.label,
      priority: lease.priority,
      demand: { ...lease.request.demand },
      holder: lease.request.holder?.id ?? null,
      queue: lease.request.queue?.key ?? null,
      since: lease.since,
    }));
    return {
      capacity,
      reserves: { system: reserves.system, interactive: reserves.interactive },
      leased: view(leased),
      available: { interactive: available('interactive'), background: available('background') },
      leases,
      holders: [...this.#holders.values()].map((h) => ({
        holder: h.id,
        demand: { ...h.demand },
        users: h.users,
        processes: h.processes,
        since: h.since,
      })),
      waiting: this.#ordered().map((w) => ({
        owner: w.request.owner,
        label: w.request.label,
        priority: w.request.priority ?? 'background',
        demand: { ...w.request.demand },
        holder: w.request.holder?.id ?? null,
        queue: w.request.queue?.key ?? null,
        wait: w.wait,
      })),
    };
  }

  // ---- 准入 ----

  #pump(): void {
    if (this.#pumping) {
      this.#again = true;
      return;
    }
    this.#pumping = true;
    try {
      do {
        this.#again = false;
        this.#pass();
      } while (this.#again);
    } finally {
      this.#pumping = false;
    }
    this.#maybeRefresh();
  }

  /** 先交互后后台、各自按先后看一遍排队的工作。 */
  #pass(): void {
    const capacity = this.#capacity.current();
    const reserves = this.#reserves(capacity);
    const leased = this.#leased(capacity);
    /** 前面有工作在等的维度：后来的不能拿这些维度（不插队）。 */
    const blocked = new Set<ResourceDimension>();
    /** 每个队列前面还在等的数目。 */
    const queued = new Map<string, number>();
    /** 队列没满、但前面同一队列的工作在等资源时，它在等的维度（后来的同样算等资源）。 */
    const queueBlockedOn = new Map<string, ResourceDimension[]>();
    let resourceAhead = 0;
    for (const waiter of this.#ordered()) {
      if (!this.#waiters.includes(waiter)) continue;
      const { request } = waiter;
      const priority = request.priority ?? 'background';
      const key = request.queue?.key ?? null;
      if (key !== null) {
        const queue = this.#queue(key, request.queue!.concurrency);
        const ahead = queued.get(key) ?? 0;
        if (ahead > 0 || queue.running >= queue.concurrency) {
          queued.set(key, ahead + 1);
          const dimensions = queue.running >= queue.concurrency ? undefined : queueBlockedOn.get(key);
          if (dimensions) {
            this.#setWait(waiter, { reason: 'resources', dimensions, ahead: resourceAhead, ...waitDetail(resourceDetail(dimensions, true)) });
            resourceAhead++;
          } else {
            this.#setWait(waiter, { reason: 'concurrency', ahead, ...waitDetail(concurrencyDetail(ahead)) });
          }
          continue;
        }
      }
      const additional = this.#additional(request, capacity);
      const exceeded = this.#exceeded(additional, priority, capacity);
      if (exceeded.length > 0) {
        this.#remove(waiter);
        this.#log.warn('Resource demand exceeds machine capacity; rejected', { owner: request.owner, label: request.label, exceeded });
        this.#call(() => waiter.handlers.reject(new ResourceExceedsCapacity(exceeded)));
        continue;
      }
      const line = this.#line(priority, capacity, reserves);
      const short: ResourceDimension[] = [];
      const behind: ResourceDimension[] = [];
      for (const d of RESOURCE_DIMENSIONS) {
        if (additional[d] <= 0 || !enforced(d, capacity)) continue;
        if (leased[d] + additional[d] > line[d]) short.push(d);
        else if (blocked.has(d)) behind.push(d);
      }
      if (short.length === 0 && behind.length === 0) {
        for (const d of RESOURCE_DIMENSIONS) leased[d] += additional[d];
        this.#diskPeak = Math.max(this.#diskPeak, leased.scratchDisk);
        this.#admit(waiter);
        continue;
      }
      for (const d of short) blocked.add(d);
      const dimensions = RESOURCE_DIMENSIONS.filter((d) => short.includes(d) || behind.includes(d));
      if (key !== null) {
        queued.set(key, (queued.get(key) ?? 0) + 1);
        if (!queueBlockedOn.has(key)) queueBlockedOn.set(key, dimensions);
      }
      this.#setWait(waiter, {
        reason: 'resources',
        dimensions,
        ahead: resourceAhead,
        ...waitDetail(resourceDetail(dimensions, short.length === 0)),
      });
      resourceAhead++;
    }
    this.#maybeEvict(blocked, capacity);
  }

  #admit(waiter: Waiter): void {
    this.#remove(waiter);
    const { request } = waiter;
    if (request.queue) this.#queue(request.queue.key, request.queue.concurrency).running++;
    if (request.holder) {
      let holder = this.#holders.get(request.holder.id);
      if (!holder) {
        holder = {
          id: request.holder.id,
          demand: { ...request.holder.demand },
          users: 0,
          processes: 0,
          since: new Date().toISOString(),
          lastUsed: Date.now(),
          evict: null,
          evicting: false,
        };
        this.#holders.set(holder.id, holder);
      }
      holder.users++;
      holder.lastUsed = Date.now();
      holder.evicting = false;
    }
    const lease: Lease = {
      leaseId: randomUUID(),
      request,
      priority: request.priority ?? 'background',
      since: new Date().toISOString(),
      released: false,
    };
    this.#leases.set(lease.leaseId, lease);
    const handle: ResourceLease = { leaseId: lease.leaseId, release: () => this.#release(lease) };
    if (waiter.wait) this.#call(() => waiter.handlers.wait?.(null));
    let admitted = false;
    this.#call(() => {
      waiter.handlers.admit(handle);
      admitted = true;
    });
    if (!admitted) handle.release();
  }

  #release(lease: Lease): void {
    if (lease.released) return;
    lease.released = true;
    this.#leases.delete(lease.leaseId);
    const { request } = lease;
    if (request.queue) {
      const queue = this.#queues.get(request.queue.key);
      if (queue) {
        queue.running--;
        if (queue.running <= 0 && !this.#waiters.some((w) => w.request.queue?.key === request.queue!.key)) {
          this.#queues.delete(request.queue.key);
        }
      }
    }
    if (request.holder) {
      const holder = this.#holders.get(request.holder.id);
      if (holder) {
        holder.users--;
        holder.lastUsed = Date.now();
        this.#dropIfUnused(holder);
      }
    }
    this.#pump();
  }

  /** 空闲的 holder（没有任务在用、进程还在）挡住了排队的工作时，请最久没用的那个让位（一次一个）。 */
  #maybeEvict(blocked: Set<ResourceDimension>, capacity: ResourceCapacity): void {
    if (blocked.size === 0) return;
    if ([...this.#holders.values()].some((h) => h.evicting)) return;
    const wanted = new Set(this.#waiters.map((w) => w.request.holder?.id).filter((id): id is string => !!id));
    const candidates = [...this.#holders.values()]
      .filter((h) => h.users === 0 && h.processes > 0 && h.evict && !wanted.has(h.id))
      .filter((h) => {
        const charge = chargeOf(h.demand, capacity);
        return [...blocked].some((d) => charge[d] > 0);
      })
      .sort((a, b) => a.lastUsed - b.lastUsed);
    const victim = candidates[0];
    if (!victim) return;
    victim.evicting = true;
    this.#log.info('Idle resident process yields to queued work', { holder: victim.id });
    this.#call(() => victim.evict!());
  }

  /** 磁盘这类会变的容量：有准入或归还时刷新（至多每 `refreshMs` 一次）；有工作在等磁盘时到期自己再刷新一次。 */
  #maybeRefresh(): void {
    const refresh = this.#capacity.refresh;
    if (!refresh || this.#refreshing) return;
    const age = performance.now() - this.#refreshedAt;
    if (age < this.#refreshMs) {
      const waitingDisk = this.#waiters.some((w) => w.wait?.dimensions?.includes('scratchDisk'));
      if (waitingDisk && !this.#refreshTimer) {
        this.#refreshTimer = setTimeout(() => {
          this.#refreshTimer = null;
          this.#pump();
        }, this.#refreshMs - age);
        this.#refreshTimer.unref?.();
      }
      return;
    }
    this.#refreshing = true;
    refresh
      .call(this.#capacity)
      .catch(() => {})
      .finally(() => {
        this.#refreshing = false;
        this.#refreshedAt = performance.now();
        this.#diskPeak = this.#leased(this.#capacity.current()).scratchDisk;
        if (this.#waiters.length > 0) this.#pump();
      });
  }

  // ---- 计量 ----

  /** 准入这项工作要新增的量：自己的需求，加上还不存在的 holder 的量。 */
  #additional(request: ResourceRequest, capacity: ResourceCapacity): Amounts {
    const own = chargeOf(request.demand ?? {}, capacity);
    const holder = request.holder && !this.#holders.has(request.holder.id) ? chargeOf(request.holder.demand, capacity) : ZERO;
    const total = {} as Amounts;
    for (const d of RESOURCE_DIMENSIONS) total[d] = own[d] + holder[d];
    total.cpuThreads = Math.min(total.cpuThreads, this.#cpuCeiling(capacity));
    return total;
  }

  /** 已经租出的量：每份租约自己的，加上每个 holder 的（只计一次）。 */
  #leased(capacity: ResourceCapacity): Amounts {
    const total: Amounts = { ...ZERO };
    const add = (demand: ResourceDemand) => {
      const charge = chargeOf(demand, capacity);
      charge.cpuThreads = Math.min(charge.cpuThreads, this.#cpuCeiling(capacity));
      for (const d of RESOURCE_DIMENSIONS) total[d] += charge[d];
    };
    for (const lease of this.#leases.values()) add(lease.request.demand ?? {});
    for (const holder of this.#holders.values()) add(holder.demand);
    return total;
  }

  /**
   * 这个优先级最多能用到的量：容量减系统预留，后台再减交互预留。磁盘的容量是此刻的可用空间，已经租出的部分可能已经写了
   * 一些，所以磁盘的上限把已租出的加回去（保守地按全部还没写算）。
   */
  #line(priority: ResourcePriority, capacity: ResourceCapacity, reserves: ResourceReserves): Amounts {
    const line = {} as Amounts;
    for (const d of RESOURCE_DIMENSIONS) {
      const total = capacity[d] ?? 0;
      const reserved = (reserves.system[d] ?? 0) + (priority === 'background' ? (reserves.interactive[d] ?? 0) : 0);
      line[d] = Math.max(0, total - reserved);
    }
    line.scratchDisk = Math.max(0, line.scratchDisk);
    return line;
  }

  /**
   * 什么都不租出时也放不下的维度（磁盘按探测到的可用空间加上探测以来租出的峰值）。CPU 不会超：需求按上限截断，只是变慢。
   */
  #exceeded(additional: Amounts, priority: ResourcePriority, capacity: ResourceCapacity): ExceededDimension[] {
    const line = this.#line(priority, capacity, this.#reserves(capacity));
    const leasedDisk = Math.max(this.#leased(capacity).scratchDisk, this.#diskPeak);
    const result: ExceededDimension[] = [];
    for (const d of RESOURCE_DIMENSIONS) {
      if (d === 'cpuThreads' || additional[d] <= 0 || !enforced(d, capacity)) continue;
      const limit = d === 'scratchDisk' ? line[d] + leasedDisk : line[d];
      if (additional[d] > limit) result.push({ dimension: d, demand: additional[d], limit });
    }
    return result;
  }

  /** CPU 线程的上限：后台能用的线程数（至少 1）。 */
  #cpuCeiling(capacity: ResourceCapacity): number {
    const reserves = this.#reserves(capacity);
    return Math.max(1, capacity.cpuThreads - reserves.system.cpuThreads - reserves.interactive.cpuThreads);
  }

  // ---- 杂项 ----

  #ordered(): Waiter[] {
    const rank = (w: Waiter) => ((w.request.priority ?? 'background') === 'interactive' ? 0 : 1);
    return [...this.#waiters].sort((a, b) => rank(a) - rank(b) || a.seq - b.seq);
  }

  #queue(key: string, concurrency: number): { concurrency: number; running: number } {
    let queue = this.#queues.get(key);
    if (!queue) {
      queue = { concurrency, running: 0 };
      this.#queues.set(key, queue);
    }
    queue.concurrency = concurrency;
    return queue;
  }

  #remove(waiter: Waiter): void {
    const index = this.#waiters.indexOf(waiter);
    if (index >= 0) this.#waiters.splice(index, 1);
  }

  #dropIfUnused(holder: Holder): void {
    if (holder.users <= 0 && holder.processes <= 0 && this.#holders.get(holder.id) === holder) this.#holders.delete(holder.id);
  }

  #setWait(waiter: Waiter, next: Omit<JobWait, 'since'>): void {
    const previous = waiter.wait;
    if (
      previous &&
      previous.reason === next.reason &&
      previous.ahead === next.ahead &&
      previous.detail === next.detail &&
      (previous.dimensions ?? []).join() === (next.dimensions ?? []).join()
    ) {
      return;
    }
    const wait: JobWait = { ...next, since: previous?.since ?? new Date().toISOString() };
    if (!wait.dimensions) delete wait.dimensions;
    waiter.wait = wait;
    this.#call(() => waiter.handlers.wait?.(wait));
  }

  #call(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.#log.error('Resource scheduler callback failed', { error: String(error) });
    }
  }
}

/** 一项需求在各维度上计入的量：统一内存的机器上 GPU 内存同时计入内存。 */
function chargeOf(demand: ResourceDemand, capacity: ResourceCapacity): Amounts {
  const charge: Amounts = { ...ZERO };
  for (const d of RESOURCE_DIMENSIONS) charge[d] = Math.max(0, demand[d] ?? 0);
  if (capacity.unifiedMemory) charge.memory += charge.gpuMemory;
  return charge;
}

/** 容量未知的维度不按它准入。 */
function enforced(dimension: ResourceDimension, capacity: ResourceCapacity): boolean {
  return capacity[dimension] !== null;
}

function concurrencyDetail(ahead: number): Localized {
  return ahead > 0 ? J.queuedBehind({ ahead }) : J.queuedRunning();
}

function resourceDetail(dimensions: ResourceDimension[], behind: boolean): Localized {
  const keys = dimensions.join(',');
  return behind ? J.waitingBehind({ dimensions: keys }) : J.waitingShort({ dimensions: keys });
}

/** `JobWait` 的 `detail` 与它的引用。 */
function waitDetail(detail: Localized): Pick<JobWait, 'detail' | 'detailRef'> {
  const { text, ref } = textParts(detail);
  return ref ? { detail: text, detailRef: ref } : { detail: text };
}
