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
 * 桌面端的连接都是它自己的（一个 Home 只有一个桌面端），不算，CLI 连接算在用。排队或运行中的任务都算在用。
 */
export function idleExceptSeeker(seeker: RuntimeSeeker, activity: FoundActivity): boolean {
  if (activity.activeJobs > 0) return false;
  const { desktop, cli } = activity.connections;
  return seeker === 'cli' ? desktop === 0 && cli <= 1 : cli === 0;
}

/**
 * 决定复用还是替换。`activity` 是对方的 `runtime.status`；问不到（协议版本不同，或还没问）时 null，这时不替换。
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
