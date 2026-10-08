import os from 'node:os';
import type { CredentialStore } from '@baocut/runtime-storage';
import {
  REMOTE_NODE_ERROR,
  RpcError,
  type DiscoveredNode,
  type Localized,
  type NodeHealth,
  type PairedNode,
  type RemoteNodeLostReason,
  type RemoteNodeRejectReason,
} from '@baocut/protocol';
import { silentNodeLog, type NodeLogger } from '../node-logger.ts';
import { noDiscoverer, type Discoverer } from './discovery.ts';
import { NodeClient, NodeConnectionError, NodeResponseError, rejectReason, versionCompatible } from './node-http.ts';
import { NodeStore, type PairedNodeRecord } from './node-store.ts';
import { RemoteNodeProvider, type RemoteTiming } from './remote-provider.ts';
import { NodesClient as NC } from '@baocut/protocol/messages/nodes';

/**
 * 发起端（架构设计 §6.7；节点协议规范 §9–§12）：已配对节点的存储、远端节点 Provider，以及本机网关上
 * `nodes.discover`、`nodes.pair`、`nodes.list`、`nodes.remove` 的实现。Runtime 只做装配。
 *
 * 网关错误：配对失败与远端任务一样用 `REMOTE_NODE_REJECTED` / `REMOTE_NODE_LOST`，放在 `RpcError.details.code`，
 * `details.reason` 给出原因（`RpcError.code` 是 `conflict`，同 `MODEL_UNAVAILABLE` 的做法）。
 */

export interface NodeInitiatorOptions {
  /** `<home>/store/nodes.json`。 */
  file: string;
  /** 令牌的存放（`node:<nodeId>`，架构设计 §6.8）。 */
  credentials: CredentialStore;
  log?: NodeLogger;
  discoverer?: Discoverer;
  timing?: Partial<RemoteTiming>;
  /** 配对时告诉节点的客户端名字；默认主机名。 */
  clientName?: string;
  /** `nodes.list` 每个节点的探测期限（规范：2 秒）。 */
  probeTimeoutMs?: number;
  /** `nodes.pair` 每个请求的期限。 */
  pairTimeoutMs?: number;
}

const DEFAULT_DISCOVER_MS = 2_000;
const MAX_DISCOVER_MS = 10_000;
const DEFAULT_PROBE_MS = 2_000;
const DEFAULT_PAIR_MS = 10_000;
/** `nodes.list` 判断令牌是否还有效：读一个不存在的任务，401 是已吊销，404 是有效（节点上没有新端点）。 */
const PROBE_JOB_ID = 'job_probe';

export class NodeInitiator {
  readonly store: NodeStore;
  readonly provider: RemoteNodeProvider;
  readonly #log: NodeLogger;
  readonly #discoverer: Discoverer;
  readonly #clientName: string;
  readonly #probeTimeoutMs: number;
  readonly #pairTimeoutMs: number;

  private constructor(store: NodeStore, options: NodeInitiatorOptions) {
    this.store = store;
    this.#log = options.log ?? silentNodeLog;
    this.#discoverer = options.discoverer ?? noDiscoverer;
    this.#clientName = (options.clientName ?? os.hostname()).trim().slice(0, 100) || 'BaoCut';
    this.#probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_MS;
    this.#pairTimeoutMs = options.pairTimeoutMs ?? DEFAULT_PAIR_MS;
    this.provider = new RemoteNodeProvider({ nodes: store, log: this.#log, ...(options.timing ? { timing: options.timing } : {}) });
  }

  static async open(options: NodeInitiatorOptions): Promise<NodeInitiator> {
    return new NodeInitiator(await NodeStore.open(options.file, options.credentials, options.log), options);
  }

  get clientId(): string {
    return this.store.clientId;
  }

  /** `nodeId` 或别名 → `nodeId`；没有这个节点时 null（JobManager 据此以 `not-found` 拒绝）。 */
  resolve(ref: string): string | null {
    return this.store.resolve(ref)?.nodeId ?? null;
  }

  /** 浏览局域网里的节点；`excludeNodeId` 是这台机器自己的节点。 */
  async discover(timeoutMs: number = DEFAULT_DISCOVER_MS, excludeNodeId: string | null = null): Promise<DiscoveredNode[]> {
    const bounded = Math.min(Math.max(timeoutMs, 1), MAX_DISCOVER_MS);
    const nodes = await this.#discoverer.discover(bounded).catch((error: unknown) => {
      this.#log.warn('Node discovery failed', { error: String(error) });
      return [] as DiscoveredNode[];
    });
    return nodes.filter((node) => !excludeNodeId || node.nodeId !== excludeNodeId);
  }

  /** 配对（规范 §4、§10）：先看健康（可达与版本），再用配对码换令牌；同一个节点再次配对替换原来的记录。 */
  async pair(params: { host: string; port: number; code: string; alias?: string }): Promise<PairedNode> {
    const client = new NodeClient(params.host.trim(), params.port);
    let health: NodeHealth;
    try {
      health = await client.health({ timeoutMs: this.#pairTimeoutMs });
    } catch (error) {
      throw pairFailure(error, client);
    }
    if (!health || typeof health.nodeId !== 'string' || !versionCompatible(health)) {
      throw rejectedRpc('version', NC.labelVersionIncompatible({ label: client.label }));
    }
    // 别名在用掉配对码之前检查。
    if (params.alias !== undefined) this.store.checkAlias(params.alias.trim(), health.nodeId);
    let response: { nodeId?: unknown; name?: unknown; token?: unknown };
    try {
      response = await client.pair(
        { code: params.code.trim(), clientId: this.store.clientId, clientName: this.#clientName },
        { timeoutMs: this.#pairTimeoutMs },
      );
    } catch (error) {
      throw pairFailure(error, client);
    }
    const { nodeId, name, token } = response ?? {};
    if (
      typeof nodeId !== 'string' ||
      !nodeId ||
      typeof name !== 'string' ||
      typeof token !== 'string' ||
      !token.startsWith(`${this.store.clientId}.`)
    ) {
      throw new RpcError('internal', NC.badPairResponse({ label: client.label }));
    }
    const record = await this.store.upsert({
      nodeId,
      name,
      host: client.host,
      port: client.port,
      token,
      ...(params.alias !== undefined ? { alias: params.alias } : {}),
    });
    this.#log.info('Paired with node', { node: nodeId, host: client.label });
    return paired(record, nodeId === health.nodeId ? health : null, null);
  }

  /** 已配对的节点，各带一次实时探测（并行，每个 2 秒）。 */
  async list(): Promise<PairedNode[]> {
    return Promise.all(this.store.list().map((record) => this.#probe(record)));
  }

  /** 探测一个已配对的节点（至多 2 秒）；没有这个节点时 null。 */
  async probe(nodeId: string): Promise<PairedNode | null> {
    const record = this.store.get(nodeId);
    return record ? this.#probe(record) : null;
  }

  /** 只删本机的记录与令牌；节点那边的配对由节点的用户吊销。 */
  async remove(nodeId: string): Promise<void> {
    if (!(await this.store.remove(nodeId))) throw new RpcError('not-found', NC.pairedNodeNotFound({ id: nodeId }));
    this.#log.info('Removed node', { node: nodeId });
  }

  async close(): Promise<void> {
    await this.provider.close();
    await this.store.flush();
  }

  async #probe(record: PairedNodeRecord): Promise<PairedNode> {
    const client = new NodeClient(record.host, record.port);
    const deadline = Date.now() + this.#probeTimeoutMs;
    let health: NodeHealth;
    try {
      health = await client.health({ timeoutMs: this.#probeTimeoutMs });
    } catch {
      // 连不上、超时、来源地址被拒（403）都算连不上。
      return paired(record, null, 'unreachable');
    }
    if (!health || typeof health !== 'object' || !versionCompatible(health)) return paired(record, health ?? null, 'version');
    if (health.nodeId !== record.nodeId) return paired(record, health, 'unpaired');
    // 本机读不到令牌（没有或凭据存储不可用）也算不再配对：这次配对在本机用不了。原因由 `store.credentialProblem()` 报告。
    const token = await this.store.token(record.nodeId).catch(() => null);
    if (!token) return paired(record, health, 'unpaired');
    try {
      await client.getJob(token, PROBE_JOB_ID, { timeoutMs: Math.max(deadline - Date.now(), 1) });
      return paired(record, health, null);
    } catch (error) {
      if (error instanceof NodeResponseError) {
        if (error.status === 401) return paired(record, health, 'unpaired');
        if (error.status === 426) return paired(record, health, 'version');
        return paired(record, health, null);
      }
      return paired(record, health, 'unreachable');
    }
  }
}

function paired(record: PairedNodeRecord, health: NodeHealth | null, problem: PairedNode['problem']): PairedNode {
  return {
    nodeId: record.nodeId,
    alias: record.alias,
    name: record.name,
    host: record.host,
    port: record.port,
    pairedAt: record.pairedAt,
    health,
    problem,
  };
}

function pairFailure(error: unknown, client: NodeClient): RpcError {
  if (error instanceof NodeConnectionError) return lostRpc('unreachable', NC.labelUnreachable({ label: client.label }));
  if (error instanceof NodeResponseError) {
    const reason = rejectReason(error);
    if (reason) return rejectedRpc(reason, error.message);
    return new RpcError('conflict', NC.pairRejected({ label: client.label, message: error.message }), {
      code: REMOTE_NODE_ERROR.REJECTED,
      status: error.status,
    });
  }
  return error instanceof RpcError ? error : new RpcError('internal', NC.pairFailed({ label: client.label }));
}

function rejectedRpc(reason: RemoteNodeRejectReason, message: string | Localized): RpcError {
  return new RpcError('conflict', message, { code: REMOTE_NODE_ERROR.REJECTED, reason });
}

function lostRpc(reason: RemoteNodeLostReason, message: string | Localized): RpcError {
  return new RpcError('conflict', message, { code: REMOTE_NODE_ERROR.LOST, reason });
}
