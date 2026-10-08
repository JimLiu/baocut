import fs from 'node:fs/promises';
import { readJson, writeJsonAtomic } from '@baocut/runtime-storage';
import type { PairedClient } from './pairing.ts';

/**
 * 共享状态的持久文件（节点协议规范 §11）：`<home>/store/node-share.json`，权限 0600。
 * 开关、`nodeId`、名字、端口、`allowAnySource`、各能力的开关与已配对客户端（盐与哈希，没有令牌明文）。配对码与锁定不落盘。
 */

/** 能力分项开关之前写下的文件里没有 `capabilities`：那一版只能共享这些能力，而且一律开着。 */
const LEGACY_CAPABILITIES = ['transcribe'];

export type ShareCapabilities = Record<string, { enabled: boolean }>;

export interface ShareFile {
  formatVersion: 1;
  enabled: boolean;
  /** 第一次开启共享时生成，之后不变。 */
  nodeId: string | null;
  /** null 表示用主机名。 */
  name: string | null;
  port: number;
  allowAnySource: boolean;
  /**
   * 各能力的开关。null 表示还没有开启过共享：第一次开启时，节点此刻支持的能力全部打开。
   * 不是 null 时，表里没有的能力（之后版本新加的）算关闭。
   */
  capabilities: ShareCapabilities | null;
  clients: PairedClient[];
}

export async function loadShareFile(file: string): Promise<ShareFile | null> {
  const data = await readJson<ShareFile>(file).catch(() => null);
  if (!data || data.formatVersion !== 1 || typeof data.enabled !== 'boolean' || !Array.isArray(data.clients)) return null;
  const clients = data.clients.filter(
    (c) =>
      c &&
      typeof c.clientId === 'string' &&
      typeof c.salt === 'string' &&
      typeof c.hash === 'string' &&
      typeof c.name === 'string' &&
      typeof c.pairedAt === 'string',
  );
  return {
    formatVersion: 1,
    enabled: data.enabled,
    nodeId: typeof data.nodeId === 'string' ? data.nodeId : null,
    name: typeof data.name === 'string' ? data.name : null,
    port: Number.isInteger(data.port) && data.port >= 0 && data.port <= 65_535 ? data.port : 0,
    allowAnySource: data.allowAnySource === true,
    capabilities: loadCapabilities(data as unknown as Record<string, unknown>),
    clients: clients.map((c) => ({ ...c, lastSeenAt: typeof c.lastSeenAt === 'string' ? c.lastSeenAt : null })),
  };
}

/**
 * - 没有这个键（能力分项开关之前的文件）：开启过共享（有 `nodeId`）就按那一版的规则——当时的能力全开；没开启过为 null；
 * - null：还没有开启过共享；
 * - 表：逐项读 `enabled`；形状不对的项丢掉（按关闭算），整个不是表时全部关闭。
 */
function loadCapabilities(data: Record<string, unknown>): ShareCapabilities | null {
  if (!('capabilities' in data) || data.capabilities === undefined) {
    return typeof data.nodeId === 'string' ? Object.fromEntries(LEGACY_CAPABILITIES.map((c) => [c, { enabled: true }])) : null;
  }
  const raw = data.capabilities;
  if (raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return {};
  const capabilities: ShareCapabilities = {};
  for (const [capability, entry] of Object.entries(raw as Record<string, unknown>)) {
    const enabled = entry && typeof entry === 'object' ? (entry as { enabled?: unknown }).enabled : undefined;
    if (typeof enabled === 'boolean') capabilities[capability] = { enabled };
  }
  return capabilities;
}

/** 串行写入：后发起的写一定落在后面。 */
export class ShareStore {
  readonly file: string;
  #chain: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  save(data: ShareFile): Promise<void> {
    const snapshot = structuredClone(data);
    const next = this.#chain.then(async () => {
      await writeJsonAtomic(this.file, snapshot, { mode: 0o600 });
      // 先前以别的权限创建过的文件也收紧（rename 保留的是临时文件的权限，这里只是保险）。
      await fs.chmod(this.file, 0o600);
    });
    this.#chain = next.catch(() => {});
    return next;
  }

  flush(): Promise<void> {
    return this.#chain;
  }
}
