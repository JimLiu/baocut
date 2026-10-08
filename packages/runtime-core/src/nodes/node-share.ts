import type { Logger } from '@baocut/harness';
import { NodeService, type Advertiser, type Clock, type NodeLimits, type PairingLimits } from '@baocut/nodes';
import type { RuntimeHome } from '@baocut/runtime-storage';
import type { ModelJobs } from '../models/model-jobs.ts';

/** `startRuntime` 的节点服务选项：生产用默认值，测试换成回环、假的 mDNS 与短的期限。 */
export interface NodeShareOptions {
  /** 监听的地址（默认 `0.0.0.0`）。 */
  host?: string;
  /** mDNS 登记；不给时按平台（macOS 用 `dns-sd`），null 表示不登记。 */
  advertiser?: Advertiser | null;
  clock?: Clock;
  limits?: Partial<NodeLimits>;
  pairing?: Partial<PairingLimits>;
  freeBytes?: (dir: string) => Promise<number>;
  heartbeatMs?: number;
}

/** 组装节点服务：远端任务进 Runtime 唯一的 JobManager，模型包状态来自同一个模型目录。 */
export function openNodeShare(home: RuntimeHome, models: ModelJobs, log: Logger, options: NodeShareOptions = {}): Promise<NodeService> {
  return NodeService.open({
    shareFile: home.nodeShareFile,
    jobsDir: home.nodeJobsDir,
    runner: models.jobs,
    models: models.catalog,
    log: log.child('nodes'),
    ...options,
  });
}
