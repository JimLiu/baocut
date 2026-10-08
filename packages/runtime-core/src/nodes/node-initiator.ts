import type { Logger } from '@baocut/harness';
import { NodeInitiator, defaultDiscoverer, noDiscoverer, type Discoverer, type RemoteTiming } from '@baocut/nodes';
import type { CredentialStore, RuntimeHome } from '@baocut/runtime-storage';

/** `startRuntime` 的发起端选项：生产用默认值，测试换成假的发现与短的期限。 */
export interface NodeInitiatorRuntimeOptions {
  /** 发现；不给时按平台（macOS 用 `dns-sd`），null 表示不浏览。 */
  discoverer?: Discoverer | null;
  /** 远端任务的期限与退避（测试用短的）。 */
  timing?: Partial<RemoteTiming>;
  /** 配对时告诉节点的名字；默认主机名。 */
  clientName?: string;
  probeTimeoutMs?: number;
}

/** 组装发起端：已配对节点存在 `<home>/store/nodes.json`，令牌在凭据存储里，远端节点 Provider 交给 JobManager。 */
export function openNodeInitiator(
  home: RuntimeHome,
  credentials: CredentialStore,
  log: Logger,
  options: NodeInitiatorRuntimeOptions = {},
): Promise<NodeInitiator> {
  const scoped = log.child('nodes');
  const discoverer = options.discoverer === undefined ? defaultDiscoverer(process.platform, scoped) : (options.discoverer ?? noDiscoverer);
  return NodeInitiator.open({
    file: home.nodesFile,
    credentials,
    log: scoped,
    discoverer,
    ...(options.timing ? { timing: options.timing } : {}),
    ...(options.clientName ? { clientName: options.clientName } : {}),
    ...(options.probeTimeoutMs ? { probeTimeoutMs: options.probeTimeoutMs } : {}),
  });
}
