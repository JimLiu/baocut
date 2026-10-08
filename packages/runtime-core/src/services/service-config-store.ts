import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { z } from 'zod';
import {
  DEFAULT_SERVICE_POLICY,
  MCP_DEFAULT_PORT,
  MODEL_API_DEFAULT_PORT,
  MODEL_API_MAX_CONCURRENT_LIMIT,
  ONLINE_CAPABILITIES,
  SERVICE_LEVELS,
  WEB_DEFAULT_PORT,
  WEB_METHOD_PATTERN,
  newId,
  nowIso,
  type Id,
  type ModelApiAlias,
  type ModelApiRouting,
  type ServiceClient,
  type ServiceId,
  type ServicePolicy,
  type WebServiceAccess,
} from '@baocut/protocol';
import { RcServices } from '@baocut/protocol/messages/runtime-core';
import { modelApiAlias } from '@baocut/protocol/schemas';
import { readJson, writeJsonAtomic } from '@baocut/runtime-storage';

/**
 * 对外服务的配置（架构设计 §4.8）：`store/services.json`，权限 0600，原子写。Runtime 启动时读入，服务按 `autostart` 恢复。
 *
 * - 每个服务：是否随 Runtime 启动、端口、访问策略、已发放的客户端。节点服务的配置在 `node-share.json`，不在这里。
 * - 模型接口服务另有路由开关、别名表与每客户端的并发上限（`modelApi`）；没有存过时由服务取默认值。
 * - 客户端令牌是 `<clientId>.<secret>`，`secret` 是 32 字节随机数的 base64url；只保存盐与 `sha256(盐 ‖ secret)`，
 *   比较用 `crypto.timingSafeEqual`。明文只在发放时返回一次。
 */

/** 有自己配置的服务（节点服务除外）。 */
export type ConfigurableServiceId = Exclude<ServiceId, 'node'>;

export interface StoredClient extends ServiceClient {
  salt: string;
  hash: string;
}

/** 模型接口服务自己的配置（§4.8）。 */
export interface ModelApiConfig {
  routing: ModelApiRouting;
  aliases: ModelApiAlias[];
  maxConcurrentPerClient: number;
}

export interface ServiceConfig {
  autostart: boolean;
  port: number;
  policy: ServicePolicy;
  clients: StoredClient[];
  /** 只有模型接口服务有；没有存过时为 undefined。 */
  modelApi?: ModelApiConfig;
  /** 只有 Web 服务用：只读与方法白名单（不给时只读关、默认集合）。 */
  web?: WebServiceAccess;
}

const SECRET_BYTES = 32;

const DEFAULT_PORTS: Record<ConfigurableServiceId, number> = {
  mcp: MCP_DEFAULT_PORT,
  'model-api': MODEL_API_DEFAULT_PORT,
  web: WEB_DEFAULT_PORT,
};

const clientSchema = z.object({
  clientId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  name: z.string().min(1).max(100),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  salt: z.string().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

const configSchema = z.object({
  autostart: z.boolean().optional(),
  port: z.number().int().min(0).max(65_535).optional(),
  policy: z
    .object({
      videos: z.union([z.literal('all'), z.object({ ids: z.array(z.string().min(1).max(200)) })]),
      level: z.enum(SERVICE_LEVELS),
    })
    .optional(),
  clients: z.array(clientSchema).optional(),
  modelApi: z
    .object({
      routing: z.object({ online: z.boolean(), nodes: z.boolean(), agent: z.boolean() }),
      aliases: z.array(
        z.object({
          alias: modelApiAlias,
          capability: z.enum(ONLINE_CAPABILITIES as [ModelApiAlias['capability'], ...ModelApiAlias['capability'][]]),
          providerId: z.string().min(1).max(200),
          modelId: z.string().min(1).max(200).nullable(),
        }),
      ),
      maxConcurrentPerClient: z.number().int().min(1).max(MODEL_API_MAX_CONCURRENT_LIMIT),
    })
    .optional(),
  web: z
    .object({
      readOnly: z.boolean(),
      methods: z.array(z.string().max(100).regex(WEB_METHOD_PATTERN)).max(200).nullable(),
    })
    .optional(),
});

const fileSchema = z.object({
  version: z.literal(1),
  services: z.record(z.string(), configSchema),
});

function defaults(serviceId: ConfigurableServiceId): ServiceConfig {
  return { autostart: false, port: DEFAULT_PORTS[serviceId], policy: structuredClone(DEFAULT_SERVICE_POLICY), clients: [] };
}

export class ServiceConfigStore {
  readonly #file: string;
  readonly #configs = new Map<ConfigurableServiceId, ServiceConfig>();
  #writing: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
  }

  /** 读入配置。文件不存在时全部取默认值；不是合法的配置时抛出（不覆盖，免得丢掉已发放的客户端）。 */
  async load(): Promise<void> {
    const raw = await readJson<unknown>(this.#file);
    this.#configs.clear();
    if (raw === null) return;
    const parsed = fileSchema.safeParse(raw);
    if (!parsed.success) throw new Error(RcServices.configFileInvalid({ file: this.#file }).text);
    for (const [serviceId, stored] of Object.entries(parsed.data.services)) {
      if (!(serviceId in DEFAULT_PORTS)) continue;
      const base = defaults(serviceId as ConfigurableServiceId);
      this.#configs.set(serviceId as ConfigurableServiceId, {
        autostart: stored.autostart ?? base.autostart,
        port: stored.port ?? base.port,
        policy: stored.policy ?? base.policy,
        clients: stored.clients ?? [],
        ...(stored.modelApi ? { modelApi: stored.modelApi } : {}),
        ...(stored.web ? { web: stored.web } : {}),
      });
    }
  }

  /** 一个服务的配置（副本）。 */
  get(serviceId: ConfigurableServiceId): ServiceConfig {
    return structuredClone(this.#configs.get(serviceId) ?? defaults(serviceId));
  }

  /** 改配置并落盘；落盘失败时内存里的配置不变。 */
  async update(serviceId: ConfigurableServiceId, patch: Partial<Omit<ServiceConfig, 'clients'>>): Promise<ServiceConfig> {
    await this.#mutate(serviceId, (config) => ({ ...config, ...structuredClone(patch) }));
    return this.get(serviceId);
  }

  /**
   * 把一个视频加进服务的视频名单（服务自己新建的视频）。在写入队列里按当时的配置改，并发的新建不会互相覆盖；
   * 策略是全部视频或名单里已经有它时不改。返回是否改了。
   */
  async allowVideo(serviceId: ConfigurableServiceId, videoId: Id): Promise<boolean> {
    let changed = false;
    await this.#mutate(serviceId, (config) => {
      const videos = config.policy.videos;
      if (videos === 'all' || videos.ids.includes(videoId)) return config;
      changed = true;
      return { ...config, policy: { ...config.policy, videos: { ids: [...videos.ids, videoId] } } };
    });
    return changed;
  }

  /** 发放一个客户端：令牌明文只在这里返回。 */
  async createClient(serviceId: ConfigurableServiceId, name: string): Promise<{ client: ServiceClient; token: string }> {
    const clientId = newId('mcl');
    const secret = crypto.randomBytes(SECRET_BYTES);
    const salt = crypto.randomBytes(16);
    const stored: StoredClient = {
      clientId,
      name,
      createdAt: nowIso(),
      lastUsedAt: null,
      salt: salt.toString('base64'),
      hash: digest(salt, secret).toString('hex'),
    };
    await this.#mutate(serviceId, (config) => ({ ...config, clients: [...config.clients, stored] }));
    return { client: publicClient(stored), token: `${clientId}.${secret.toString('base64url')}` };
  }

  /** 吊销一个客户端。没有这个客户端时返回 false。 */
  async revokeClient(serviceId: ConfigurableServiceId, clientId: string): Promise<boolean> {
    let found = false;
    await this.#mutate(serviceId, (config) => {
      const clients = config.clients.filter((c) => c.clientId !== clientId);
      found = clients.length !== config.clients.length;
      return { ...config, clients };
    });
    return found;
  }

  clients(serviceId: ConfigurableServiceId): ServiceClient[] {
    return (this.#configs.get(serviceId)?.clients ?? []).map(publicClient);
  }

  /** `Bearer` 之后的令牌 → 客户端；不认识、已吊销或写法不规范时为空。只在内存里记下最近使用的时间。 */
  verify(serviceId: ConfigurableServiceId, token: string): ServiceClient | null {
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const clientId = token.slice(0, dot);
    const text = token.slice(dot + 1);
    const client = this.#configs.get(serviceId)?.clients.find((c) => c.clientId === clientId);
    const secret = Buffer.from(text, 'base64url');
    // 只接受规范的 base64url：同一串字节只有一种写法。
    if (!client || secret.length !== SECRET_BYTES || secret.toString('base64url') !== text) return null;
    const expected = Buffer.from(client.hash, 'hex');
    const actual = digest(Buffer.from(client.salt, 'base64'), secret);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    client.lastUsedAt = nowIso();
    return publicClient(client);
  }

  /** 把内存里的最近使用时间写回（服务停止时）。 */
  async flush(serviceId: ConfigurableServiceId): Promise<void> {
    if (this.#configs.has(serviceId)) await this.#mutate(serviceId, (config) => config);
  }

  /** 写入排队：每一次改动都基于前一次落盘之后的配置，并发的改动不会互相覆盖。 */
  async #mutate(serviceId: ConfigurableServiceId, change: (config: ServiceConfig) => ServiceConfig): Promise<void> {
    const run = this.#writing.then(async () => {
      const config = change(this.get(serviceId));
      const all = new Map(this.#configs);
      all.set(serviceId, config);
      await writeJsonAtomic(this.#file, { version: 1, services: Object.fromEntries(all) }, { mode: 0o600 });
      // 已经存在的文件 rename 之后权限取临时文件的；这里再确认一次。
      await fs.chmod(this.#file, 0o600);
      this.#configs.set(serviceId, config);
    });
    this.#writing = run.catch(() => {});
    return run;
  }
}

function publicClient(client: StoredClient): ServiceClient {
  return { clientId: client.clientId, name: client.name, createdAt: client.createdAt, lastUsedAt: client.lastUsedAt };
}

function digest(salt: Buffer, secret: Buffer): Buffer {
  return crypto.createHash('sha256').update(salt).update(secret).digest();
}
