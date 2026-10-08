import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import {
  NODE_DEFAULT_PORT,
  NODE_ERROR,
  NODE_HEALTH_SCHEMA,
  NODE_MIN_PROTOCOL_VERSION,
  NODE_PROTOCOL_VERSION,
  NODE_SHAREABLE_CAPABILITIES,
  RUNTIME_VERSION,
  RpcError,
  newId,
  type NodeHealth,
  type NodePairResponse,
  type ShareStartParams,
  type ShareStatus,
} from '@baocut/protocol';
import { defaultAdvertiser, type Advertiser } from './advertiser.ts';
import { NodeHttpError, NodeJobs, type NodeJobRunner, type NodeLimits, type NodeModels } from './node-jobs.ts';
import { silentNodeLog, type NodeLogger } from './node-logger.ts';
import { createNodeRequestHandler } from './node-server.ts';
import { Pairing, systemClock, type Clock, type PairingLimits } from './pairing.ts';
import { ShareStore, loadShareFile, type ShareFile } from './share-store.ts';
import { NodesServer as NS } from '@baocut/protocol/messages/nodes';

/**
 * 节点服务（架构设计 §6.7、§12.7；节点协议规范）：共享这台电脑的模型能力。
 *
 * 用户经本机网关的 `nodes.share.*` 开关它；开着时在所有 IPv4 接口（测试里是回环）上监听一个端口，与本机网关分开。
 * 开关、`nodeId`、名字、端口、各能力的开关与已配对客户端持久在 `node-share.json`；`enabled` 为真时 Runtime 启动即监听，
 * 不自动生成配对码。端口被占用时 Runtime 照常启动，`ShareStatus.listening` 为 false，`error` 说明原因。
 *
 * 能力的分项开关（规范 §11）：第一次开启共享时，此刻支持共享的能力全部打开；之后新加入的能力默认关闭。开关立即生效：
 * 健康端点照实报告，关闭后新任务以 `403 CAPABILITY_DISABLED` 拒绝，已经接受的任务照常跑完。
 *
 * 远端任务交给 `NodeJobs`，它驱动的是 Runtime 唯一的 JobManager。
 */

export interface NodeServiceOptions {
  /** `<home>/store/node-share.json` */
  shareFile: string;
  /** `<home>/staging/node-jobs` */
  jobsDir: string;
  runner: NodeJobRunner;
  models: NodeModels;
  log?: NodeLogger;
  /** 监听的地址（默认 `0.0.0.0`；测试用 `127.0.0.1`）。 */
  host?: string;
  /** mDNS 登记；默认按平台（macOS 用 `dns-sd`），null 表示不登记。 */
  advertiser?: Advertiser | null;
  clock?: Clock;
  limits?: Partial<NodeLimits>;
  pairing?: Partial<PairingLimits>;
  freeBytes?: (dir: string) => Promise<number>;
  /** 支持共享的模型能力（默认 `NODE_SHAREABLE_CAPABILITIES`；测试用它模拟将来新加的能力）。 */
  shareableCapabilities?: readonly string[];
  /** 事件流心跳间隔（默认 15 秒）。 */
  heartbeatMs?: number;
  /** 默认名字（默认主机名）。 */
  hostname?: () => string;
  /** 监听所有接口时 `ShareStatus.addresses` 列出的本机地址（默认取本机非回环的 IPv4）。 */
  addresses?: () => string[];
}

export class NodeService {
  readonly jobs: NodeJobs;
  readonly #options: NodeServiceOptions;
  readonly #log: NodeLogger;
  readonly #store: ShareStore;
  readonly #advertiser: Advertiser | null;
  readonly #host: string;
  readonly #shareable: readonly string[];
  #share: ShareFile;
  #pairing: Pairing;
  #server: http.Server | null = null;
  #boundPort: number | null = null;
  /** 实际绑定的地址（`server.address()`），没在监听时为 null。 */
  #boundAddress: string | null = null;
  #error: string | null = null;
  /** `node-share.json` 读不了或认不出：共享关着、不能修改，也不写那个文件。 */
  readonly #unreadable: string | null;
  /** 开关操作串行。 */
  #chain: Promise<unknown> = Promise.resolve();
  #closed = false;

  private constructor(options: NodeServiceOptions, share: ShareFile, unreadable: string | null) {
    this.#options = options;
    this.#log = options.log ?? silentNodeLog;
    this.#store = new ShareStore(options.shareFile);
    this.#advertiser = options.advertiser === undefined ? defaultAdvertiser(process.platform, this.#log) : options.advertiser;
    this.#host = options.host ?? '0.0.0.0';
    this.#shareable = options.shareableCapabilities ?? NODE_SHAREABLE_CAPABILITIES;
    this.#share = share;
    this.#unreadable = unreadable;
    this.#pairing = this.#newPairing(share);
    this.jobs = new NodeJobs({
      dir: options.jobsDir,
      runner: options.runner,
      models: options.models,
      capabilityEnabled: (capability) => this.#capabilityEnabled(capability),
      log: this.#log,
      ...(options.limits ? { limits: options.limits } : {}),
      ...(options.freeBytes ? { freeBytes: options.freeBytes } : {}),
    });
  }

  /**
   * 读持久状态、清掉上次留下的远端任务目录；开关是开的就开始监听（不生成配对码）。
   * `node-share.json` 读不了或认不出时不让 Runtime 启动失败：共享按关着处理，修改共享的操作以 `conflict` 拒绝，
   * `ShareStatus.error` 说明原因；文件原样留着，修好或移走之后重启生效。
   */
  static async open(options: NodeServiceOptions): Promise<NodeService> {
    const log = options.log ?? silentNodeLog;
    const loaded = await loadShareFile(options.shareFile, log);
    const unreadable = loaded && 'unreadable' in loaded ? loaded.unreadable : null;
    if (unreadable) log.error('Share file is unreadable; sharing is off and cannot be changed until it is fixed or removed', { reason: unreadable });
    const share = (loaded && !('unreadable' in loaded) ? loaded : null) ?? {
      formatVersion: 1,
      enabled: false,
      nodeId: null,
      name: null,
      port: NODE_DEFAULT_PORT,
      allowAnySource: false,
      capabilities: null,
      clients: [],
    };
    const service = new NodeService(options, share, unreadable);
    await service.jobs.sweep();
    if (share.enabled) await service.#listen();
    return service;
  }

  // ---- 本机网关的 nodes.share.*（规范 §10） ----

  start(params: ShareStartParams = {}): Promise<ShareStatus> {
    return this.#serial(async () => {
      if (this.#closed) throw new RpcError('busy', NS.runtimeStopping());
      this.#assertWritable();
      const share = this.#share;
      const portChanged = params.port !== undefined && params.port !== share.port;
      const nameChanged = params.name !== undefined && params.name !== share.name;
      share.nodeId ??= newId('node');
      share.capabilities ??= this.#initialCapabilities();
      if (params.port !== undefined) share.port = params.port;
      if (params.name !== undefined) share.name = params.name;
      if (params.allowAnySource !== undefined) share.allowAnySource = params.allowAnySource;
      share.enabled = true;
      await this.#save();
      if (this.#server && portChanged) await this.#unlisten();
      if (!this.#server) await this.#listen();
      else if (nameChanged) this.#advertise();
      this.#pairing.newCode();
      this.#log.info('Sharing turned on', { listening: this.#server !== null, port: this.#boundPort ?? share.port });
      return this.status();
    });
  }

  stop(): Promise<ShareStatus> {
    return this.#serial(async () => {
      this.#assertWritable();
      this.#share.enabled = false;
      await this.#save();
      await this.#shutdown();
      this.#log.info('Sharing turned off');
      return this.status();
    });
  }

  status(): ShareStatus {
    const share = this.#share;
    return {
      enabled: share.enabled,
      listening: this.#server !== null,
      error: this.#unreadable !== null ? NS.shareFileUnreadable({ reason: this.#unreadable }).text : share.enabled && !this.#server ? this.#error : null,
      nodeId: share.nodeId,
      name: this.#name(),
      port: this.#boundPort ?? share.port,
      addresses: shareAddresses(this.#boundAddress, this.#options.addresses ?? lanAddresses),
      allowAnySource: share.allowAnySource,
      capabilities: Object.fromEntries(this.#shareable.map((c) => [c, { enabled: this.#capabilityEnabled(c) }])),
      pairing: share.enabled ? this.#pairing.state() : null,
      clients: this.#pairing.clients().map(({ clientId, name, pairedAt, lastSeenAt }) => ({ clientId, name, pairedAt, lastSeenAt })),
      jobs: this.jobs.counts(),
    };
  }

  pairingCode(): ShareStatus {
    if (!this.#share.enabled) throw new RpcError('conflict', NS.sharingOff());
    this.#pairing.newCode();
    return this.status();
  }

  revoke(clientId: string): Promise<ShareStatus> {
    return this.#serial(async () => {
      this.#assertWritable();
      if (!this.#pairing.revoke(clientId)) throw new RpcError('not-found', NS.clientNotFound());
      this.#share.clients = this.#pairing.clients();
      await this.#save();
      await this.jobs.removeClient(clientId);
      this.#log.info('Revoked client', { clientId });
      return this.status();
    });
  }

  /**
   * 打开或关闭一种能力的共享（规范 §10、§11），持久并立即生效：健康端点随即报告新状态；关闭只拦新任务，
   * 已经接受的任务（含还在等上传的）照常跑完。共享没开时也可以设，开启时沿用。
   */
  setCapability(capability: string, enabled: boolean): Promise<ShareStatus> {
    return this.#serial(async () => {
      this.#assertWritable();
      if (!this.#shareable.includes(capability)) {
        throw new RpcError('invalid-request', NS.capabilityNotShareable({ capability, shareable: this.#shareable.join(NS.listSeparator().text) }), {
          capability,
          shareable: [...this.#shareable],
        });
      }
      const capabilities = (this.#share.capabilities ??= this.#initialCapabilities());
      capabilities[capability] = { enabled };
      await this.#save();
      this.#log.info(enabled ? 'Capability sharing turned on' : 'Capability sharing turned off', { capability });
      return this.status();
    });
  }

  /** 监听中的实际端口（测试与诊断用）。 */
  get port(): number | null {
    return this.#boundPort;
  }

  /** Runtime 停止：取消并删除远端任务，关闭监听与 mDNS 登记。开关保持原样，下次启动恢复。 */
  close(): Promise<void> {
    return this.#serial(async () => {
      if (this.#closed) return;
      this.#closed = true;
      await this.#shutdown();
      this.jobs.detach();
      this.#share.clients = this.#pairing.clients();
      await this.#save().catch(() => {});
    });
  }

  // ---- 节点协议 ----

  async health(): Promise<NodeHealth> {
    const bundles = (await this.#options.models.list()).filter((b) => b.capability === 'transcribe');
    let running = 0;
    let queued = 0;
    for (const job of this.#options.runner.list()) {
      if (job.state === 'running') running++;
      else if (job.state === 'queued') queued++;
    }
    return {
      schema: NODE_HEALTH_SCHEMA,
      nodeId: this.#share.nodeId ?? '',
      name: this.#name(),
      nodeProtocolVersion: NODE_PROTOCOL_VERSION,
      minNodeProtocolVersion: NODE_MIN_PROTOCOL_VERSION,
      runtimeVersion: RUNTIME_VERSION,
      platform: { os: process.platform, arch: process.arch },
      capabilities: {
        transcribe: {
          enabled: this.#capabilityEnabled('transcribe'),
          bundles: bundles.map(({ bundleId, backend, device, state }) => ({ bundleId, backend, device, state })),
          running,
          queued,
        },
      },
    };
  }

  async pair(code: string, clientId: string, clientName: string): Promise<NodePairResponse> {
    const outcome = this.#pairing.pair(code, clientId, clientName);
    if (!outcome.ok) {
      this.#log.warn('Pairing failed', { reason: outcome.code });
      if (outcome.code === 'PAIRING_LOCKED') {
        throw new NodeHttpError(NODE_ERROR.PAIRING_LOCKED, NS.pairingLocked().text, { retryAfterMs: outcome.retryAfterMs });
      }
      throw new NodeHttpError(NODE_ERROR.PAIRING_CODE_INVALID, NS.pairingCodeInvalid().text);
    }
    // 同一个 clientId 重新配对：旧令牌已失效，它之前的任务不受影响。
    this.#share.clients = this.#pairing.clients();
    await this.#save();
    this.#log.info('Client paired', { clientId });
    return { nodeId: this.#share.nodeId!, name: this.#name(), token: outcome.token };
  }

  // ---- 内部 ----

  /** 还没有开启过共享时，按开启时的默认（全开）报告；之后以持久的表为准，表里没有的能力算关闭。 */
  #capabilityEnabled(capability: string): boolean {
    if (!this.#shareable.includes(capability)) return false;
    const capabilities = this.#share.capabilities;
    return capabilities === null ? true : capabilities[capability]?.enabled === true;
  }

  /** 第一次开启共享（或第一次设开关）时：此刻支持共享的能力全部打开。 */
  #initialCapabilities(): Record<string, { enabled: boolean }> {
    return Object.fromEntries(this.#shareable.map((c) => [c, { enabled: true }]));
  }

  #name(): string {
    return this.#share.name ?? (this.#options.hostname ?? defaultHostname)();
  }

  #newPairing(share: ShareFile): Pairing {
    return new Pairing(share.clients, {
      ...(this.#options.clock ? { clock: this.#options.clock } : { clock: systemClock }),
      ...(this.#options.pairing ? { limits: this.#options.pairing } : {}),
    });
  }

  async #listen(): Promise<void> {
    const share = this.#share;
    share.nodeId ??= newId('node');
    const handler = createNodeRequestHandler({
      jobs: this.jobs,
      health: () => this.health(),
      pair: (code, clientId, clientName) => this.pair(code, clientId, clientName),
      authenticate: (token) => this.#pairing.verify(token)?.clientId ?? null,
      allowAnySource: () => this.#share.allowAnySource,
      log: this.#log,
      ...(this.#options.heartbeatMs !== undefined ? { heartbeatMs: this.#options.heartbeatMs } : {}),
    });
    const server = http.createServer(handler);
    // 大文件的上传由任务的上传期限管，不用 Node 默认的整请求 300 秒。
    server.requestTimeout = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen({ port: share.port, host: this.#host }, () => {
          server.off('error', reject);
          resolve();
        });
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      this.#error = code === 'EADDRINUSE' ? NS.portInUse({ port: share.port }).text : NS.cannotListen({ code: code ?? String(error) }).text;
      this.#log.warn('Node service cannot listen', { port: share.port, code });
      return;
    }
    server.on('error', (error) => this.#log.error('Node service error', { error: String(error) }));
    this.#server = server;
    const bound = server.address() as AddressInfo;
    this.#boundPort = bound.port;
    this.#boundAddress = bound.address;
    this.#error = null;
    this.#log.info('Node service listening', { port: this.#boundPort });
    this.#advertise();
  }

  #advertise(): void {
    if (!this.#advertiser || !this.#server || this.#boundPort === null) return;
    this.#advertiser.start({ name: this.#name(), port: this.#boundPort, nodeId: this.#share.nodeId!, version: NODE_PROTOCOL_VERSION });
  }

  async #unlisten(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#boundPort = null;
    this.#boundAddress = null;
    await this.#advertiser?.stop().catch(() => {});
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // 事件流与上传是长连接：一并断开。
      server.closeAllConnections();
    });
  }

  /** 共享关闭与 Runtime 停止共用：先取消并删除远端任务（事件流收到终态），再关监听与登记。 */
  async #shutdown(): Promise<void> {
    await this.jobs.closeAll();
    await this.#unlisten();
    this.#pairing.clearCode();
    this.#error = null;
  }

  #save(): Promise<void> {
    if (this.#unreadable !== null) return Promise.resolve();
    return this.#store.save(this.#share);
  }

  #assertWritable(): void {
    if (this.#unreadable !== null) throw new RpcError('conflict', NS.shareFileUnreadable({ reason: this.#unreadable }));
  }

  #serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#chain.then(task, task);
    this.#chain = next.catch(() => {});
    return next;
  }
}

function defaultHostname(): string {
  return os.hostname().replace(/\.local\.?$/, '') || 'BaoCut';
}

/**
 * 节点服务此刻能被连上的地址：没在监听时为空；绑定在所有接口（`0.0.0.0`、`::`）上时是本机的局域网地址；
 * 绑定在具体地址上（包括回环地址）时只有这一个地址，别的接口连不上。
 */
export function shareAddresses(boundAddress: string | null, interfaces: () => string[]): string[] {
  if (boundAddress === null) return [];
  if (boundAddress === '0.0.0.0' || boundAddress === '::') return interfaces();
  return [boundAddress];
}

/** 本机可供别人连接的非回环 IPv4 地址。 */
export function lanAddresses(): string[] {
  const found: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) found.push(info.address);
    }
  }
  return found;
}
