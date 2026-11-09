import type { RuntimeInfo, RuntimeStatus } from './domain.ts';

/**
 * 复用还是替换同一个 Home 上已经在跑的 Runtime（CLI 独立使用与发布 §4.2）。桌面端与 CLI 共用这一份规则，各自负责读发现信息、
 * 问 `runtime.status`、请它停下与拉起自己的。
 */

/** 要用 Runtime 的这一份安装自己的版本。`build` 查不出时 null（只比 `runtimeVersion`）。 */
export interface RuntimeIdentity {
  runtimeVersion: string;
  protocolVersion: string;
  interfaceVersion: string;
  build: string | null;
}

export type RuntimeSeeker = 'desktop' | 'cli';

/** 对方的发现信息里用得上的几项。旧版 Runtime 没有 `interfaceVersion` 与 `build`。 */
export type FoundRuntime = Pick<RuntimeInfo, 'runtimeVersion' | 'protocolVersion' | 'launchedBy' | 'interfaceVersion' | 'build'>;

/** 对方的 `runtime.status` 里用得上的几项：连接数含发起方自己的。 */
export type FoundActivity = Pick<RuntimeStatus, 'connections' | 'activeJobs'>;

/**
 * 协议版本不同的 Runtime 在握手的拒绝里报的忙闲（`protocol-mismatch` 的 `details`，命令与协议规范 §2）。`activeJobs` 是有排队或运行中
 * 的任务数，`activity` 是 `activeJobs` 与 `connections` 都在时的忙闲；连接数不含发起方自己的（它没握上手）。旧版 Runtime 缺哪一项，
 * 哪一项就是 null：问不到忙不忙时不替换。
 */
export interface MismatchFacts {
  activeJobs: number | null;
  activity: FoundActivity | null;
}

export function mismatchFacts(details: unknown): MismatchFacts {
  const wire = typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : {};
  const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const activeJobs = count(wire.activeJobs) ? wire.activeJobs : null;
  const raw = typeof wire.connections === 'object' && wire.connections !== null ? (wire.connections as Record<string, unknown>) : null;
  const connections = raw && count(raw.desktop) && count(raw.cli) && count(raw.agent) ? { desktop: raw.desktop, cli: raw.cli, agent: raw.agent } : null;
  return { activeJobs, activity: activeJobs !== null && connections ? { activeJobs, connections } : null };
}

/**
 * - `reuse`：版本相同，照常连。
 * - `replace`：版本不同、对方是 CLI 拉起的并且空闲：请它停下（`runtime.stop`），等它放开实例锁，再拉起自己的。
 * - `refuse`（CLI）：版本不同，对方忙着或不是 CLI 拉起的，或问不到它忙不忙：照版本门拒绝，说明对方是谁拉起的、有几个任务。
 * - `reuse-until-idle`（桌面端，协议版本相同）：先连上用，界面标出后台 Runtime 的版本与拉起者；它空闲后再替换。
 * - `wait`（桌面端，协议版本不同）：不连，说明后台的旧版 Runtime 在做事，等它做完后自动替换。
 */
export type RuntimeReuse =
  | { action: 'reuse' }
  | { action: 'replace' }
  | { action: 'refuse' }
  | { action: 'reuse-until-idle' }
  | { action: 'wait' };

/**
 * 版本相同吗：桌面端比 `runtimeVersion` 与 `build`（自己的 `build` 查不出时只比前者；对方没有 `build` 算不同）；CLI 比
 * `interfaceVersion`，接口版本相同而 `runtimeVersion` 不同时照样算相同。
 */
export function sameRuntimeVersion(seeker: RuntimeSeeker, own: RuntimeIdentity, found: FoundRuntime): boolean {
  if (seeker === 'cli') return found.interfaceVersion === own.interfaceVersion;
  if (found.runtimeVersion !== own.runtimeVersion) return false;
  return own.build === null || found.build === own.build;
}

/**
 * 发起方之外没有人在用：与 `runtime.stop` 的拒绝条件相同。CLI 发起时它自己那条 CLI 连接不算，桌面端连接算在用；桌面端发起时
 * 桌面端的连接都是它自己的（一个 Home 只有一个桌面端），不算，CLI 连接算在用。排队或运行中的任务都算在用。`seekerCounted` 为
 * false 时 `connections` 里没有发起方自己的那条（协议版本不同，没握上手），CLI 发起时一条 CLI 连接也不许有。
 */
export function idleExceptSeeker(seeker: RuntimeSeeker, activity: FoundActivity, seekerCounted = true): boolean {
  if (activity.activeJobs > 0) return false;
  const { desktop, cli } = activity.connections;
  return seeker === 'cli' ? desktop === 0 && cli <= (seekerCounted ? 1 : 0) : cli === 0;
}

/**
 * 协议版本不同、握手被拒时对方空闲没有（§4.3），按握手拒绝里报的忙闲（`mismatchFacts`）；发起方没握上手，不在连接数里。只报了
 * 任务数（没有连接数）时有任务算忙、没有任务也说不准；什么都没报时 null。握手被拒本身说明版本不同，不再比 `interfaceVersion`：
 * 协议版本变了而接口版本没变时 `decideRuntimeReuse` 会判成复用。
 */
export function idleOnMismatch(seeker: RuntimeSeeker, facts: MismatchFacts): boolean | null {
  if (facts.activity) return idleExceptSeeker(seeker, facts.activity, false);
  return facts.activeJobs !== null && facts.activeJobs > 0 ? false : null;
}

/**
 * 决定复用还是替换。`activity` 是对方的 `runtime.status`；问不到（协议版本不同，或还没问）时 null，这时不替换。协议版本不同时
 * 改用 `idleOnMismatch`。
 */
export function decideRuntimeReuse(input: {
  seeker: RuntimeSeeker;
  own: RuntimeIdentity;
  found: FoundRuntime;
  activity: FoundActivity | null;
}): RuntimeReuse {
  const { seeker, own, found, activity } = input;
  if (sameRuntimeVersion(seeker, own, found)) return { action: 'reuse' };
  if (found.launchedBy === 'cli' && activity && idleExceptSeeker(seeker, activity)) return { action: 'replace' };
  if (seeker === 'cli') return { action: 'refuse' };
  return found.protocolVersion === own.protocolVersion ? { action: 'reuse-until-idle' } : { action: 'wait' };
}
