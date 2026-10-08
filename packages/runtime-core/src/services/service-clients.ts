import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RpcError, refOf, type ServiceClient, type ServiceRequestRecord } from '@baocut/protocol';
import { RcServices } from '@baocut/protocol/messages/runtime-core';
import type { Logger } from '@baocut/harness';
import type { ConfigurableServiceId, ServiceConfigStore } from './service-config-store.ts';

/**
 * 对外服务共用的客户端与监听（架构设计 §4.8、§12.8），MCP 服务与模型接口服务各用一份：
 *
 * - 客户端：每个外部应用一枚令牌（`Authorization: Bearer <令牌>`），明文只在发放时返回一次，配置里只存加盐的哈希；
 *   吊销立即生效。发放与吊销记日志（只记 clientId），并通知服务的状态变了。
 * - 监听：只在回环地址上，端口被占用时给出原因（服务进入 `error`），不换端口；停止时立即断开已有连接。
 * - 最近的请求：调用方、工具或端点、目标与结果，新的在前，至多 20 条；不含令牌与正文。
 */

export const LOOPBACK_HOST = '127.0.0.1';
const RECENT_LIMIT = 20;

export class ServiceClients {
  readonly #store: ServiceConfigStore;
  readonly #serviceId: ConfigurableServiceId;
  readonly #log: Logger;
  readonly #label: string;
  readonly #onChange: () => void;

  constructor(options: { store: ServiceConfigStore; serviceId: ConfigurableServiceId; label: string; log: Logger; onChange: () => void }) {
    this.#store = options.store;
    this.#serviceId = options.serviceId;
    this.#label = options.label;
    this.#log = options.log;
    this.#onChange = options.onChange;
  }

  async create(name: string): Promise<{ client: ServiceClient; token: string }> {
    const created = await this.#store.createClient(this.#serviceId, name);
    this.#log.info(`Issued ${this.#label} client`,{ clientId: created.client.clientId });
    this.#onChange();
    return created;
  }

  list(): ServiceClient[] {
    return this.#store.clients(this.#serviceId);
  }

  async revoke(clientId: string): Promise<ServiceClient[]> {
    if (!(await this.#store.revokeClient(this.#serviceId, clientId))) throw new RpcError('not-found', RcServices.clientNotFound());
    this.#log.info(`Revoked ${this.#label} client`, { clientId });
    this.#onChange();
    return this.list();
  }

  /** 给了 `clientId` 时找到它（连接信息里写客户端名）；没有这个客户端时 `not-found`。 */
  find(clientId: string | undefined): ServiceClient | undefined {
    if (clientId === undefined) return undefined;
    const client = this.list().find((c) => c.clientId === clientId);
    if (!client) throw new RpcError('not-found', RcServices.clientNotFound());
    return client;
  }

  /** `Authorization: Bearer <令牌>` → 客户端；缺失、写法不对、不认识或已吊销时为 null。 */
  authenticate(request: IncomingMessage): ServiceClient | null {
    const match = /^Bearer\s+(\S+)$/.exec(request.headers.authorization ?? '');
    return match ? this.#store.verify(this.#serviceId, match[1]!) : null;
  }
}

/** 在回环地址上开始监听，返回实际端口。失败时抛出给用户看的原因（端口被占用之类）。 */
export async function listenLoopback(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(listenError(port, error));
    });
    server.listen(port, LOOPBACK_HOST, () => resolve());
  });
  return (server.address() as AddressInfo).port;
}

/** 监听失败的原因（给用户看，服务进入 `error` 时显示）：端口被占用，或系统给的原因。 */
export function listenError(port: number, error: NodeJS.ErrnoException): Error {
  const message = error.code === 'EADDRINUSE' ? RcServices.portInUse({ port }) : RcServices.cannotListen({ port, reason: error.message });
  return Object.assign(new Error(message.text), { messageRef: refOf(message) });
}

/** 立即断开已有连接并停止监听（§12.8）。 */
export async function closeLoopback(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** 最近的外部请求（审计，§12.8）：新的在前，至多 20 条。 */
export class RecentRequests {
  #records: ServiceRequestRecord[] = [];

  add(record: ServiceRequestRecord): void {
    this.#records = [record, ...this.#records].slice(0, RECENT_LIMIT);
  }

  list(): ServiceRequestRecord[] {
    return this.#records.map((r) => ({ ...r }));
  }
}
