import {
  RpcError,
  driverAvailability,
  nowIso,
  refOf,
  type CustomAgentProviderView,
  type DriverId,
  type DriverProbe,
  type Id,
} from '@baocut/protocol';
import { HarnessAgents as HA } from '@baocut/protocol/messages/harness';
import { driverProbeFacts, type AgentProbeStore, type StoredDriverProbes } from '@baocut/runtime-storage';
import type {
  AgentDriver,
  AgentEvent,
  AgentPersistenceHandle,
  AgentSession,
  AgentToolAccess,
  DriverDescription,
  ToolGrant,
  TurnSettings,
} from './driver.ts';
import { silentLogger, type Logger } from './logger.ts';

export interface DriverRefreshOptions {
  /** 不用 Driver 自己的缓存（`ProbeOptions.force`），也不与正在进行的非强制探测共用一次。 */
  force?: boolean;
  /** 为什么探测（写进日志）：startup、detect、configure、setup、list、stale、correction…… */
  reason: string;
}

interface InflightProbe {
  /** 回来时用它认出自己还是不是这个 Driver 当前的那次探测：被强制探测或换了可执行文件顶替的，结果丢掉。 */
  token: object;
  force: boolean;
  promise: Promise<DriverProbe>;
}

/**
 * Driver 注册表（架构设计 §3.1、§3.11）。`AgentDriver` 与 `ModelProvider` 分开注册。
 *
 * 探测结果按 Driver 缓存，没有时效（§3.11）：
 * - 启动时先读磁盘缓存（`store/agent-probes.json`，`load`），界面立刻有上次的结果；随后由 Harness 后台刷新一轮。
 * - 每个 Driver 独立探测、各自完成各自写入：完成一个就写进缓存、落盘、通知（`onChange`），慢的（ACP 的冷启动）不拖累快的；
 *   探测抛错记成 `error` 结果，不清掉别的 Driver。同一个 Driver 同时到来的刷新共用一次探测。
 * - 只在这些时候重新探测：启动、「重新检测」、改了可执行文件、安装结束、运行中出了说明缓存过时的错（Harness 决定），
 *   以及 `recheckStale` 的便宜纠正与 `current` 的按需探测。
 *
 * 注册表是动态的：用户添加的 ACP 智能体（`agents.addProvider`）在运行中注册，移除时注销（`unregister`），连同它的结果、
 * 进行中的探测与缓存条目。注册时带上 `custom`（它的配置摘要）的是用户添加的，其余是内置的。
 */
export class DriverRegistry {
  readonly #drivers = new Map<DriverId, AgentDriver>();
  readonly #custom = new Map<DriverId, CustomAgentProviderView>();
  readonly #executables = new Map<DriverId, string>();
  readonly #results = new Map<DriverId, DriverProbe>();
  readonly #inflight = new Map<DriverId, InflightProbe>();
  readonly #listeners = new Set<(id: DriverId) => void>();
  #store: AgentProbeStore | null = null;
  #log: Logger = silentLogger;
  #closed = false;

  /** 注册（或替换）一个 Driver。`custom`：用户添加的智能体的配置摘要；不给是内置的。 */
  register(driver: AgentDriver, options: { custom?: CustomAgentProviderView } = {}): void {
    this.#drivers.set(driver.id, driver);
    if (options.custom) this.#custom.set(driver.id, structuredClone(options.custom));
    else this.#custom.delete(driver.id);
    this.#results.delete(driver.id);
    this.#inflight.delete(driver.id);
  }

  /**
   * 注销一个 Driver：丢掉它的结果与可执行文件，作废进行中的探测（回来的结果不再写入），探测缓存文件里的条目随即删掉。
   * 返回是否注册过。偏好与会话由 Harness 处理。
   */
  unregister(id: DriverId): boolean {
    if (!this.#drivers.delete(id)) return false;
    this.#custom.delete(id);
    this.#executables.delete(id);
    this.#results.delete(id);
    this.#inflight.delete(id);
    if (!this.#closed) this.#persist();
    return true;
  }

  has(id: DriverId): boolean {
    return this.#drivers.has(id);
  }

  /** 用户添加的智能体的配置摘要；内置的、没注册的为 null。 */
  custom(id: DriverId): CustomAgentProviderView | null {
    const found = this.#custom.get(id);
    return found ? structuredClone(found) : null;
  }

  /**
   * 用户手动指定的可执行文件（设置 › 高级）。探测与新会话都用它。改了就丢掉这个 Driver 的结果（它属于另一个可执行文件）
   * 并作废正在进行的探测；重新探测由调用方发起。返回是否真的变了。
   */
  setExecutable(id: DriverId, executable: string | null): boolean {
    if ((this.#executables.get(id) ?? null) === executable) return false;
    if (executable) this.#executables.set(id, executable);
    else this.#executables.delete(id);
    this.#results.delete(id);
    this.#inflight.delete(id);
    return true;
  }

  executable(id: DriverId): string | null {
    return this.#executables.get(id) ?? null;
  }

  ids(): DriverId[] {
    return [...this.#drivers.keys()];
  }

  get(id: DriverId): AgentDriver {
    const driver = this.#drivers.get(id);
    if (!driver) throw new RpcError('driver-unavailable', HA.noDriver({ id }));
    return driver;
  }

  /**
   * 读磁盘缓存作为各 Driver 的初始结果。先设好可执行文件再调用：条目里探测时用的可执行文件与现在的不一致就丢掉；
   * 没注册的 Driver、没有 `describe()` 的 Driver 的条目忽略；文件坏了当没有缓存。之后每次探测完成都写回这个文件。
   */
  async load(store: AgentProbeStore, log: Logger = silentLogger): Promise<void> {
    this.#store = store;
    this.#log = log;
    const stored = await store.load().catch((error: unknown) => {
      log.warn('Failed to read the Agent probe cache; continuing without it', { error: String(error) });
      return {} as StoredDriverProbes;
    });
    for (const [id, entry] of Object.entries(stored) as [DriverId, NonNullable<StoredDriverProbes[DriverId]>][]) {
      const driver = this.#drivers.get(id);
      if (!driver?.describe || this.#results.has(id) || this.#inflight.has(id)) continue;
      const { executableOverride, ...facts } = entry;
      if (executableOverride !== this.executable(id)) continue;
      this.#results.set(id, { ...driver.describe(), ...facts, ...driverAvailability(facts.state), id });
    }
  }

  /** 已有的探测结果（含磁盘缓存来的），按注册顺序；还没有结果的 Driver 不在里面（见 `checking`）。 */
  snapshot(): DriverProbe[] {
    return this.ids().flatMap((id) => this.#results.get(id) ?? []);
  }

  result(id: DriverId): DriverProbe | null {
    return this.#results.get(id) ?? null;
  }

  /** 还没有任何结果、正在（或即将）首次探测的 Driver。 */
  checking(): DriverId[] {
    return this.ids().filter((id) => !this.#results.has(id));
  }

  /** 某个 Driver 的结果变了（探测完成）。 */
  onChange(listener: (id: DriverId) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 重新探测这些 Driver（默认全部），每个完成就写入并通知；全部结束（成功或记成 error）后兑现，从不拒绝。 */
  async refresh(ids: DriverId[] = this.ids(), options: DriverRefreshOptions): Promise<void> {
    await Promise.allSettled(ids.filter((id) => this.#drivers.has(id)).map((id) => this.#probe(id, options)));
  }

  /**
   * 一个 Driver 的结果，供只关心这一个的调用方（智能体 Provider，§6.9）：`maxAgeMs` 之内的直接用，否则只探测它并等待，
   * 结果照常写进缓存、通知。没注册为 null。
   */
  async current(id: DriverId, maxAgeMs: number): Promise<DriverProbe | null> {
    if (!this.#drivers.has(id)) return null;
    const cached = this.#results.get(id);
    if (cached && Date.now() - Date.parse(cached.checkedAt) <= maxAgeMs) return cached;
    return this.#probe(id, { reason: 'provider' });
  }

  /**
   * 便宜的纠正（§3.11）：探测只有 `--version`、登录状态这类快命令的 Driver 结果不是 `ready`、
   * 又超过 `maxAgeMs` 没探过的，后台再探一次。`slowProbe` 的（ACP、Pi、OpenCode，每次都要拉起一个智能体进程）不做。
   */
  recheckStale(maxAgeMs: number): void {
    for (const id of this.ids()) {
      const result = this.#results.get(id);
      if (!result || result.state === 'ready' || this.#inflight.has(id)) continue;
      if (this.#drivers.get(id)!.slowProbe === true) continue;
      if (Date.now() - Date.parse(result.checkedAt) <= maxAgeMs) continue;
      void this.#probe(id, { reason: 'stale' });
    }
  }

  /** Runtime 停止：之后完成的探测不再写入、落盘与通知。 */
  close(): void {
    this.#closed = true;
    this.#listeners.clear();
  }

  /** 等最后一次落盘写完。 */
  flush(): Promise<void> {
    return this.#store?.flush() ?? Promise.resolve();
  }

  #probe(id: DriverId, options: DriverRefreshOptions): Promise<DriverProbe> {
    const force = options.force === true;
    const running = this.#inflight.get(id);
    if (running && (running.force || !force)) return running.promise;
    const driver = this.#drivers.get(id)!;
    const executable = this.executable(id);
    const token = {};
    const startedAt = Date.now();
    const promise = Promise.resolve()
      .then(() => driver.probe({ executable, ...(force ? { force: true } : {}) }))
      .catch((error: unknown) => failedProbe(driver, executable, error))
      .then((probe) => {
        if (this.#inflight.get(id)?.token !== token) return probe;
        this.#inflight.delete(id);
        if (this.#closed) return probe;
        this.#results.set(id, probe);
        this.#log.info('Agent probe finished', { driverId: id, state: probe.state, reason: options.reason, force, ms: Date.now() - startedAt });
        this.#persist();
        for (const listener of this.#listeners) listener(id);
        return probe;
      });
    this.#inflight.set(id, { token, force, promise });
    return promise;
  }

  #persist(): void {
    const store = this.#store;
    if (!store) return;
    const drivers: StoredDriverProbes = {};
    for (const [id, probe] of this.#results) drivers[id] = { ...driverProbeFacts(probe), executableOverride: this.executable(id) };
    store.save(drivers).catch((error: unknown) => this.#log.warn('Failed to write the Agent probe cache', { error: String(error) }));
  }
}

/** Driver 的探测抛错（本不该抛）：记成 `error` 结果，常量能拿到就用 `describe()` 的。 */
function failedProbe(driver: AgentDriver, executable: string | null, error: unknown): DriverProbe {
  const description: DriverDescription = driver.describe?.() ?? {
    id: driver.id,
    name: driver.id,
    command: driver.id,
    minVersion: '',
    plan: '',
    loginCommand: null,
    install: [],
    verified: driver.verified !== false,
    tested: driver.tested ?? driver.verified !== false,
    capabilities: { steer: false, approvals: false, resume: false, images: false },
  };
  const detail = HA.probeFailed({ error: error instanceof Error ? error.message : String(error) });
  return {
    ...description,
    id: driver.id,
    state: 'error',
    ...driverAvailability('error'),
    version: null,
    latestVersion: null,
    detail: detail.text,
    detailRef: refOf(detail),
    executable,
    realExecutable: null,
    account: null,
    models: [],
    configModel: null,
    configModelKnown: null,
    checkedAt: nowIso(),
  };
}

interface LiveSession {
  session: AgentSession;
  driverId: DriverId;
  grant: ToolGrant | null;
  unsubscribe: () => void;
}

export interface EnsureSessionOptions {
  conversationId: Id;
  driverId: DriverId;
  cwd: string;
  /** 新建原生会话时的初始设置；已有会话不看它，每轮的设置随 `startTurn` 传。 */
  settings: TurnSettings;
  resume: AgentPersistenceHandle | null;
}

/**
 * AgentManager：每个会话至多一个活的原生会话（架构设计 §2.1「Agent 进程：按会话」）。
 * 访问模式、模型、强度按回合传给 Driver，不因此重开；只有换了 Agent（还没有任务的会话）才关掉旧的。
 */
export class AgentManager {
  readonly #drivers: DriverRegistry;
  readonly #onEvent: (conversationId: Id, session: AgentSession, event: AgentEvent) => void;
  readonly #log: Logger;
  readonly #tools: AgentToolAccess | null;
  readonly #live = new Map<Id, LiveSession>();
  readonly #starting = new Map<Id, Promise<AgentSession>>();

  constructor(
    drivers: DriverRegistry,
    onEvent: (conversationId: Id, session: AgentSession, event: AgentEvent) => void,
    log: Logger,
    tools: AgentToolAccess | null = null,
  ) {
    this.#drivers = drivers;
    this.#onEvent = onEvent;
    this.#log = log.child('agents');
    this.#tools = tools;
  }

  get(conversationId: Id): AgentSession | null {
    return this.#live.get(conversationId)?.session ?? null;
  }

  async ensure(options: EnsureSessionOptions): Promise<AgentSession> {
    const pending = this.#starting.get(options.conversationId);
    if (pending) return pending;
    const live = this.#live.get(options.conversationId);
    if (live && live.driverId === options.driverId) return live.session;

    const start = (async () => {
      let resume = options.resume;
      if (live) {
        // 换了 Agent：旧的恢复句柄属于另一个 Agent，不能拿来续。
        resume = null;
        await this.release(options.conversationId);
      }
      if (resume && resume.driverId !== options.driverId) resume = null;
      const driver = this.#drivers.get(options.driverId);
      // 工具授权跟着原生会话走：会话关闭（空闲、进程退出）时收回。
      // 会话开始时的附加指导（开着的 skill 的索引，§3.8）：取不到时不附，不拦住会话。
      const extra = this.#tools?.sessionInstructions
        ? await this.#tools.sessionInstructions(options.conversationId).catch((error: unknown) => {
            this.#log.warn('Failed to read extra session instructions', { conversationId: options.conversationId, error: String(error) });
            return '';
          })
        : '';
      const grant = this.#tools?.grant(options.conversationId) ?? null;
      let session: AgentSession;
      try {
        session = await driver.createSession({
          cwd: options.cwd,
          ...options.settings,
          executable: this.#drivers.executable(options.driverId),
          resume,
          ...(this.#tools ? { developerInstructions: extra ? `${this.#tools.instructions}\n\n${extra}` : this.#tools.instructions } : {}),
          ...(grant ? { mcpServers: grant.mcpServers } : {}),
        });
      } catch (error) {
        grant?.revoke();
        throw error;
      }
      const unsubscribe = session.subscribe((event) => this.#onEvent(options.conversationId, session, event));
      this.#live.set(options.conversationId, { session, driverId: options.driverId, grant, unsubscribe });
      this.#log.info('Native session ready', { conversationId: options.conversationId, driverId: options.driverId });
      return session;
    })();
    this.#starting.set(options.conversationId, start);
    try {
      return await start;
    } finally {
      this.#starting.delete(options.conversationId);
    }
  }

  /** 进程已经退出时只摘掉记录，不再调用 close。 */
  forget(conversationId: Id, session: AgentSession): void {
    const live = this.#live.get(conversationId);
    if (live?.session !== session) return;
    live.unsubscribe();
    live.grant?.revoke();
    this.#live.delete(conversationId);
  }

  async release(conversationId: Id): Promise<void> {
    const live = this.#live.get(conversationId);
    if (!live) return;
    this.#live.delete(conversationId);
    live.unsubscribe();
    live.grant?.revoke();
    await live.session.close().catch((error) => {
      this.#log.warn('Failed to close native session', { conversationId, error: String(error) });
    });
  }

  async releaseAll(): Promise<void> {
    await Promise.allSettled([...this.#starting.values()]);
    await Promise.all([...this.#live.keys()].map((id) => this.release(id)));
  }
}
