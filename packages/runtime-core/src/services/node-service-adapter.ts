import { RpcError, type ShareStatus } from '@baocut/protocol';
import { RcServices } from '@baocut/protocol/messages/runtime-core';
import type { NodeService } from '@baocut/nodes';
import type { ManagedService, ServiceReport } from './service-manager.ts';

/**
 * 节点服务在 ServiceManager 里的样子（架构设计 §4.8、§6.7）。权威是 `NodeService`（`nodes.share.*` 与 `node-share.json`），
 * 这里只把它的状态投影成统一的形状，不另存一份：
 *
 * - 共享没开：`off`；开着且在监听：`on`；开着却没在监听（端口被占用）：`error`，原因来自节点服务；
 * - 「随 Runtime 启动」就是共享的开关（开着的共享在 Runtime 启动时恢复监听）；
 * - 配置（端口、名字、配对、能力）只用 `nodes.share.*`；配对码与已配对客户端只在 `nodes.share.status` 里，不在这里转述。
 */
export class NodeServiceAdapter implements ManagedService {
  readonly id = 'node' as const;
  get label(): string {
    return RcServices.nodeServiceLabel().text;
  }
  readonly available = true;
  readonly projected = true;
  readonly #nodes: NodeService;

  constructor(nodes: NodeService) {
    this.#nodes = nodes;
  }

  async start(): Promise<void> {
    await this.#nodes.start({});
  }

  async stop(): Promise<void> {
    await this.#nodes.stop();
  }

  status(): ServiceReport {
    return projectShare(this.#nodes.status());
  }

  async applyConfig(): Promise<boolean> {
    throw new RpcError('invalid-request', RcServices.nodeServiceConfigure());
  }
}

export function projectShare(share: ShareStatus): ServiceReport {
  const state = !share.enabled ? 'off' : share.listening ? 'on' : 'error';
  const address = share.addresses[0];
  return {
    state,
    error: state === 'error' ? (share.error ?? RcServices.nodeServiceNotListening().text) : null,
    autostart: share.enabled,
    port: share.port,
    endpoint: share.listening && address ? `http://${address}:${share.port}` : null,
    policy: null,
    clients: [],
    recentRequests: [],
  };
}
