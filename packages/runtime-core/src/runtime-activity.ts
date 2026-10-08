import type { RuntimeInfo, RuntimeStatus } from '@baocut/protocol';
import type { TrustedPrincipal } from './gateway.ts';

/**
 * Runtime 有没有人在用（架构设计 §2.2）：本机网关上已认证的连接、还没结束的任务、开着的对外服务，以及同一端口上的 HTTP 请求
 * （会话里的智能体经工具桥调用工具，不占 WebSocket 连接）。`runtime.status` 报告它；CLI 拉起的 Runtime（`--idle-exit`）
 * 空闲满 `runtime.idleExitMinutes` 时经 `onIdle` 自己退出。
 *
 * Web 服务与对外服务的连接走各自的端口，不在连接数里；它们开着就算不空闲。
 *
 * CLI 连接在发出第一个别的请求之前不算在用：只查状态（`runtime.status`、`runtime.info`）的连接（`baocut runtime status`）
 * 既不让空闲计时清零，断开时也不让它重新算，报出的 `idleSince` 是查询之前的值。
 */

export interface ActivitySources {
  info: RuntimeInfo;
  /** 排队或运行中的任务数。 */
  activeJobs: () => number;
  /** 开着（或正在开、正在关）的对外服务的 id。 */
  runningServices: () => string[];
}

export interface IdleExitOptions {
  /** 空闲多少分钟后退出（设置 `runtime.idleExitMinutes`，每次检查时读）。 */
  minutes: () => number;
  onIdle: () => void;
  /** 检查的间隔（默认 15 秒）。测试用短的。 */
  checkMs?: number;
  now?: () => number;
}

const DEFAULT_CHECK_MS = 15_000;

/** 只读 Runtime 本身状态的方法：CLI 连接只发这些时不算在用。 */
const PASSIVE_METHODS: ReadonlySet<string> = new Set(['runtime.status', 'runtime.info']);

type CountedKind = keyof RuntimeStatus['connections'];

export class RuntimeActivity {
  readonly #sources: ActivitySources;
  readonly #idle: IdleExitOptions | null;
  readonly #now: () => number;
  readonly #connections: Record<CountedKind, number> = { desktop: 0, cli: 0, agent: 0 };
  /** 还没发过别的请求的 CLI 连接。 */
  readonly #passive = new Set<string>();
  #idleSince: number | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #fired = false;

  constructor(sources: ActivitySources, idle: IdleExitOptions | null) {
    this.#sources = sources;
    this.#idle = idle;
    this.#now = idle?.now ?? Date.now;
  }

  /** 开始按间隔检查（只有带空闲退出时）。计时器不挡进程退出。 */
  start(): void {
    if (!this.#idle || this.#timer) return;
    this.#idleSince = this.#busy() ? null : this.#now();
    this.#timer = setInterval(() => this.check(), this.#idle.checkMs ?? DEFAULT_CHECK_MS);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  connected(principal: TrustedPrincipal): void {
    if (isCounted(principal.kind)) this.#connections[principal.kind]++;
    if (principal.kind === 'cli') this.#passive.add(principal.connectionId);
    else this.#idleSince = null;
  }

  /** 连接发来一个请求（握手之后）：CLI 连接第一次发出查状态以外的请求时开始算在用。 */
  requested(principal: TrustedPrincipal, method: string): void {
    if (PASSIVE_METHODS.has(method) || !this.#passive.delete(principal.connectionId)) return;
    this.#idleSince = null;
  }

  disconnected(principal: TrustedPrincipal): void {
    if (isCounted(principal.kind)) this.#connections[principal.kind] = Math.max(0, this.#connections[principal.kind] - 1);
    // 只查过状态的连接来去不改空闲计时；在用的连接断开后不再忙时，空闲从现在算。
    if (this.#passive.delete(principal.connectionId)) return;
    if (!this.#busy()) this.#idleSince = this.#now();
  }

  /** 有请求进来（HTTP 的工具桥、媒体通道）：空闲从现在重新算。 */
  touch(): void {
    if (this.#idleSince !== null) this.#idleSince = this.#now();
  }

  /** 检查一次：忙就清零；空闲满时调用 `onIdle`（只调一次）。 */
  check(): void {
    if (!this.#idle || this.#fired) return;
    if (this.#busy()) {
      this.#idleSince = null;
      return;
    }
    const now = this.#now();
    this.#idleSince ??= now;
    if (now - this.#idleSince >= this.#idle.minutes() * 60_000) {
      this.#fired = true;
      this.stop();
      this.#idle.onIdle();
    }
  }

  status(): RuntimeStatus {
    const busy = this.#busy();
    return {
      info: this.#sources.info,
      connections: { ...this.#connections },
      activeJobs: this.#sources.activeJobs(),
      runningServices: this.#sources.runningServices(),
      idleExit: this.#idle
        ? {
            minutes: this.#idle.minutes(),
            idleSince: busy || this.#idleSince === null ? null : new Date(this.#idleSince).toISOString(),
          }
        : null,
    };
  }

  #busy(): boolean {
    const { desktop, cli, agent } = this.#connections;
    return desktop + cli + agent - this.#passive.size > 0 || this.#sources.activeJobs() > 0 || this.#sources.runningServices().length > 0;
  }
}

function isCounted(kind: TrustedPrincipal['kind']): kind is CountedKind {
  return kind === 'desktop' || kind === 'cli' || kind === 'agent';
}
