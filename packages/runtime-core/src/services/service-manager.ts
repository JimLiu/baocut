import {
  isMessageRef,
  RpcError,
  SERVICE_IDS,
  type MessageRef,
  type ServiceConfigureParams,
  type ServiceId,
  type ServiceState,
  type ServiceStatus,
  type ServicesEvent,
  type ServicesSnapshot,
} from '@baocut/protocol';
import { RcServices } from '@baocut/protocol/messages/runtime-core';
import { TopicLog, type Logger } from '@baocut/harness';
import type { ServiceApprovals } from './service-approvals.ts';

/**
 * 对外服务的统一管理（架构设计 §4.8）。一个服务是一个 `ManagedService`：`start` / `stop` / `status` / `applyConfig`。
 *
 * - 状态 `off`、`starting`、`on`、`stopping`、`error` 由这里维护；投影服务（节点服务）的状态来自它自己的权威（`nodes.share.*`），
 *   这里只转述，不另存一份。
 * - 默认 `off`；`restore` 只开启配置了随 Runtime 启动的服务。开启失败（端口被占用）进入 `error` 并说明原因，不换端口、不影响 Runtime。
 * - 这个版本没有提供的服务照样列出（`available: false`，状态总是 `off`），开启时以 `SERVICE_NOT_AVAILABLE` 拒绝。
 * - 状态变化与服务审批经 `services` 主题送达。
 */

/** 服务自己报告的部分：状态之外的配置与运行信息。 */
export type ServiceReport = Omit<ServiceStatus, 'serviceId' | 'label' | 'available' | 'state' | 'error'> & {
  /** 投影服务自己给出状态与原因。 */
  state?: ServiceState;
  error?: string | null;
};

export interface ManagedService {
  readonly id: ServiceId;
  readonly label: string;
  /** 这个版本是否提供。 */
  readonly available: boolean;
  /** 状态来自服务自己的权威（节点服务）：`status()` 带 `state` 与 `error`。 */
  readonly projected?: boolean;
  /** 开始监听。失败时抛出，消息就是给用户看的原因。 */
  start(): Promise<void>;
  /** 停止监听并断开已有连接。 */
  stop(): Promise<void>;
  status(): ServiceReport;
  /** 改配置并落盘。返回 true 表示开着时要按新配置重启监听（例如端口变了）。 */
  applyConfig(params: ServiceConfigureParams): Promise<boolean>;
}

/** 这个版本没有提供的服务：列出来，状态总是 `off`。 */
export class UnavailableService implements ManagedService {
  readonly available = false;
  readonly id: ServiceId;
  readonly label: string;
  readonly #port: number;

  constructor(id: ServiceId, label: string, port: number) {
    this.id = id;
    this.label = label;
    this.#port = port;
  }

  async start(): Promise<void> {
    throw notAvailable(this.id);
  }

  async stop(): Promise<void> {}

  status(): ServiceReport {
    return { autostart: false, port: this.#port, endpoint: null, policy: null, clients: [], recentRequests: [] };
  }

  async applyConfig(): Promise<boolean> {
    throw notAvailable(this.id);
  }
}

export function notAvailable(serviceId: ServiceId): RpcError {
  return new RpcError('conflict', RcServices.serviceNotAvailable({ serviceId }), { code: 'SERVICE_NOT_AVAILABLE', serviceId });
}

export class ServiceManager {
  readonly topic: TopicLog<ServicesSnapshot, ServicesEvent>;
  readonly approvals: ServiceApprovals;
  readonly #services = new Map<ServiceId, ManagedService>();
  readonly #states = new Map<ServiceId, { state: ServiceState; error: string | null; errorRef?: MessageRef }>();
  /** 每个服务同时只有一个开启、停止或改配置在进行。 */
  readonly #queues = new Map<ServiceId, Promise<unknown>>();
  readonly #log: Logger;
  #closed = false;

  constructor(options: { log: Logger; approvals: (manager: ServiceManager) => ServiceApprovals }) {
    this.#log = options.log.child('services');
    this.topic = new TopicLog<ServicesSnapshot, ServicesEvent>(() => this.snapshot(), '0');
    this.approvals = options.approvals(this);
  }

  /** 登记一个服务。同一个 ID 只能登记一次。 */
  register(service: ManagedService): void {
    if (this.#services.has(service.id)) throw new Error(`Service ${service.id} is already registered`);
    this.#services.set(service.id, service);
    this.#states.set(service.id, { state: 'off', error: null });
  }

  snapshot(): ServicesSnapshot {
    return { services: this.list(), approvals: this.approvals.pending() };
  }

  /** 全部服务，按 `SERVICE_IDS` 的顺序。 */
  list(): ServiceStatus[] {
    return SERVICE_IDS.flatMap((id) => (this.#services.has(id) ? [this.status(id)] : []));
  }

  status(serviceId: ServiceId): ServiceStatus {
    const service = this.#get(serviceId);
    const report = service.status();
    const own = this.#states.get(serviceId)!;
    const { state: projectedState, error: projectedError, ...rest } = report;
    const state = service.projected ? (projectedState ?? 'off') : own.state;
    // 投影服务在开启、停止的过程中也报告过渡状态。
    const transitional = own.state === 'starting' || own.state === 'stopping' ? own.state : null;
    return {
      serviceId,
      label: service.label,
      available: service.available,
      state: service.projected ? (transitional ?? state) : state,
      error: service.projected ? (projectedError ?? null) : own.error,
      ...(!service.projected && own.errorRef ? { errorRef: own.errorRef } : {}),
      ...rest,
    };
  }

  /** 服务的状态或配置变了（投影服务的权威被改过、客户端或最近的请求变了）：送一条 `service.updated`。 */
  refresh(serviceId: ServiceId): void {
    if (!this.#services.has(serviceId)) return;
    this.topic.publish({ type: 'service.updated', service: this.status(serviceId) });
  }

  start(serviceId: ServiceId): Promise<ServiceStatus> {
    const service = this.#get(serviceId);
    if (!service.available) return Promise.reject(notAvailable(serviceId));
    return this.#serialize(serviceId, async () => {
      if (this.#closed) throw new RpcError('busy', RcServices.runtimeStopping());
      if (this.status(serviceId).state === 'on') return this.status(serviceId);
      await this.#run(service);
      return this.status(serviceId);
    });
  }

  stop(serviceId: ServiceId): Promise<ServiceStatus> {
    const service = this.#get(serviceId);
    return this.#serialize(serviceId, async () => {
      await this.#halt(service);
      return this.status(serviceId);
    });
  }

  configure(params: ServiceConfigureParams): Promise<ServiceStatus> {
    const service = this.#get(params.serviceId);
    if (!service.available) return Promise.reject(notAvailable(params.serviceId));
    return this.#serialize(params.serviceId, async () => {
      const restart = await service.applyConfig(params);
      const state = this.status(params.serviceId).state;
      // 开着（或开启失败）时按新配置重新开启：改了端口就在新端口上试。
      if (restart && !this.#closed && (state === 'on' || state === 'error')) {
        await this.#halt(service);
        await this.#run(service);
      } else {
        this.refresh(params.serviceId);
      }
      return this.status(params.serviceId);
    });
  }

  /** Runtime 启动时：开启配置了随 Runtime 启动的服务。失败只影响那个服务的状态。 */
  async restore(): Promise<void> {
    for (const service of this.#services.values()) {
      if (!service.available || service.projected || !service.status().autostart) continue;
      await this.start(service.id).catch((error: unknown) =>
        this.#log.warn('Service failed to start with Runtime', { serviceId: service.id, error: String(error) }),
      );
    }
  }

  /** Runtime 停止：停掉开着的服务（投影服务由它自己的权威停），待处理的审批全部取消。 */
  async close(): Promise<void> {
    this.#closed = true;
    await Promise.all(
      [...this.#services.values()]
        .filter((service) => !service.projected)
        .map((service) => this.#serialize(service.id, () => this.#halt(service)).catch(() => {})),
    );
  }

  async #run(service: ManagedService): Promise<void> {
    this.#set(service.id, 'starting', null);
    try {
      await service.start();
      this.#set(service.id, 'on', null);
      this.#log.info('Service started', { serviceId: service.id });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.#log.warn('Service failed to start', { serviceId: service.id, error: reason });
      // 投影服务的失败由它自己的权威记着（例如端口被占用时节点服务不抛出，状态里有原因）；抛出的是请求本身的错误，原样交给调用方。
      if (service.projected) {
        this.#set(service.id, 'off', null);
        throw error;
      }
      const ref = (error as { messageRef?: unknown } | null)?.messageRef;
      this.#set(service.id, 'error', reason, isMessageRef(ref) ? ref : undefined);
    }
  }

  async #halt(service: ManagedService): Promise<void> {
    const before = this.status(service.id).state;
    if (before === 'off' && !service.projected) return;
    this.approvals.cancelService(service.id);
    this.#set(service.id, 'stopping', null);
    try {
      await service.stop();
    } finally {
      this.#set(service.id, 'off', null);
      this.#log.info('Service stopped', { serviceId: service.id });
    }
  }

  #set(serviceId: ServiceId, state: ServiceState, error: string | null, errorRef?: MessageRef): void {
    this.#states.set(serviceId, errorRef ? { state, error, errorRef } : { state, error });
    this.refresh(serviceId);
  }

  #serialize<T>(serviceId: ServiceId, task: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(serviceId) ?? Promise.resolve();
    const run = previous.then(task, task);
    this.#queues.set(
      serviceId,
      run.catch(() => {}),
    );
    return run;
  }

  #get(serviceId: ServiceId): ManagedService {
    const service = this.#services.get(serviceId);
    if (!service) throw new RpcError('not-found', RcServices.serviceNotFound({ serviceId }));
    return service;
  }
}
