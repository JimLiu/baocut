import type { Id } from './domain.ts';
import type { MessageRef } from './message-ref.ts';

/**
 * 资源调度（架构设计 §7.6、§7.7）：重的本机任务先按峰值工作集准入，拿到租约才开始；放不下时排队，记录上写着在等什么。
 * 字节数一律是 bytes。
 */

/** 准入的资源维度：内存、GPU 内存（统一内存的机器上同时计入内存）、CPU 线程、staging 所在卷的磁盘。 */
export type ResourceDimension = 'memory' | 'gpuMemory' | 'cpuThreads' | 'scratchDisk';

export const RESOURCE_DIMENSIONS: readonly ResourceDimension[] = ['memory', 'gpuMemory', 'cpuThreads', 'scratchDisk'];

/** 各维度的量。容量里 null 表示未知（不按这一维准入，§9.6「未知时报告未知」）。 */
export interface ResourceAmounts {
  memory: number;
  gpuMemory: number | null;
  cpuThreads: number;
  scratchDisk: number | null;
}

/** 一项工作声明的峰值需求；没有的维度为 0。 */
export type ResourceDemand = Partial<Record<ResourceDimension, number>>;

/** 准入的优先级：`interactive` 是用户在界面上同步等着的短操作，可以用交互预留；其余都是 `background`。 */
export type ResourcePriority = 'interactive' | 'background';

/**
 * 排队任务在等什么（`JobRecord.wait`）：`concurrency` 是同一队列的并发上限（同一个模型包、同一个 Provider……），
 * `resources` 是机器上的资源不够（`dimensions` 是缺的维度；前面有任务在等同样的资源时也算，不插队）。开始执行时去掉。
 */
export interface JobWait {
  reason: 'concurrency' | 'resources';
  /** `resources` 时：缺的维度。 */
  dimensions?: ResourceDimension[];
  /** 同一队列或同样的资源前面还有几个在等。 */
  ahead?: number;
  /** 给人看的一句话。 */
  detail: string;
  /** `detail` 的消息引用：显示时按读者的语言重新渲染。 */
  detailRef?: MessageRef;
  /** 开始等的时间。 */
  since: string;
}

/** 机器的容量与来源：`system` 取自操作系统，`setting` 取自偏好设置 `resources.capacity`，`unified-estimate` 按统一内存估计。 */
export interface ResourceCapacity extends ResourceAmounts {
  /** GPU 与 CPU 共用内存（Apple 芯片）：GPU 的需求同时计入内存。 */
  unifiedMemory: boolean;
  sources: {
    memory: 'system' | 'setting';
    gpuMemory: 'unified-estimate' | 'setting' | 'unknown';
    cpuThreads: 'system' | 'setting';
    scratchDisk: 'statfs' | 'unknown';
  };
}

/** 一份租约：任务（或其中一步）占用的量。 */
export interface ResourceLeaseView {
  leaseId: string;
  /** 任务的 `jobId`。 */
  owner: Id;
  /** 给人看的种类：`transcribe`、`export:video`…… */
  label: string;
  priority: ResourcePriority;
  /** 这份租约自己计入的量（共用 holder 的量记在 holder 上，不重复计）。 */
  demand: ResourceDemand;
  /** 用到的共用 holder（例如 `model-worker:<bundleId>`）。 */
  holder: string | null;
  /** 所在的并发队列。 */
  queue: string | null;
  since: string;
}

/** 被几个任务先后共用的常驻资源（例如一个模型包的 Model Worker 进程）：量只计一次。 */
export interface ResourceHolderView {
  holder: string;
  demand: ResourceDemand;
  /** 正在用它的租约数；0 表示空闲（进程还在，可以被驱逐给别的任务让位）。 */
  users: number;
  /** 还没确认退出的进程数：进程真的退出（或模型卸载）之前，holder 的量不归还。 */
  processes: number;
  since: string;
}

export interface ResourceWaiterView {
  owner: Id;
  label: string;
  priority: ResourcePriority;
  demand: ResourceDemand;
  holder: string | null;
  queue: string | null;
  wait: JobWait | null;
}

/** `jobs.resources`：容量、预留、已租出的量、此刻各优先级还能用的量、租约与排队。 */
export interface ResourcesSnapshot {
  capacity: ResourceCapacity;
  reserves: {
    /** 留给系统与其他应用，任何任务都不用。 */
    system: ResourceAmounts;
    /** 留给交互操作：后台任务不能用。 */
    interactive: ResourceAmounts;
  };
  leased: ResourceAmounts;
  available: { interactive: ResourceAmounts; background: ResourceAmounts };
  leases: ResourceLeaseView[];
  holders: ResourceHolderView[];
  waiting: ResourceWaiterView[];
}

/**
 * 偏好设置 `resources.capacity`：覆盖自动探测的容量（MiB 与线程数）。某一项为 null 时照旧自动探测；
 * 整个设置为 null 时全部自动。磁盘不能覆盖（按 staging 所在卷的可用空间）。
 */
export interface ResourceCapacitySetting {
  memoryMiB: number | null;
  gpuMemoryMiB: number | null;
  cpuThreads: number | null;
}
