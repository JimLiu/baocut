import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { CREDENTIAL_UNAVAILABLE } from '@baocut/models';
import { RpcError } from '@baocut/protocol';
import { JsonStoreFile, credentialProblem, nodeCredentialKey, type CredentialStore } from '@baocut/runtime-storage';
import { silentNodeLog, type NodeLogger } from '../node-logger.ts';
import { NodesClient as NC } from '@baocut/protocol/messages/nodes';

/**
 * 发起端的持久状态（节点协议规范 §11）：`<home>/store/nodes.json`，权限 0600。
 *
 * - `clientId`：这台 Runtime 在所有节点眼里的标识，第一次打开时生成，之后不变（节点用它区分客户端、同一个
 *   `clientId` 再次配对替换旧令牌）。
 * - `nodes`：已配对的节点（没有令牌）。别名在本机唯一：默认取节点的名字，冲突时加 `-2`、`-3`……；同一个 `nodeId`
 *   再次配对替换原来的记录、保留别名（除非这次指定了新的别名）。
 * - 令牌经 `CredentialStore` 存放，key 是 `node:<nodeId>`（架构设计 §6.8）；只在用到时取，只进 `Authorization` 头。
 *
 * 之前的版本把令牌写在这个文件的记录里：打开时逐个迁进凭据存储，迁成功的从文件里去掉；迁不成功的（凭据存储不可用）
 * 原样留在文件里等下次启动再迁，但不拿来用——不回退到明文。
 *
 * 写入是临时文件加改名，串行；内存里的状态是权威，文件是它的快照。
 */

export interface PairedNodeRecord {
  nodeId: string;
  alias: string;
  name: string;
  host: string;
  port: number;
  pairedAt: string;
}

interface StoredNode extends PairedNodeRecord {
  /** 旧版本写在文件里、还没迁进凭据存储的令牌。 */
  token?: string;
}

interface NodesFile {
  formatVersion: 1;
  clientId: string;
  nodes: StoredNode[];
}

/** 节点协议对 `clientId` 的要求（令牌是 `<clientId>.<secret>`，所以不能含 `.`）。 */
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ALIAS_MAX = 63;

export class NodeStore {
  readonly file: string;
  readonly #file: JsonStoreFile;
  readonly #data: NodesFile;
  readonly #credentials: CredentialStore;
  /** 读不到令牌的节点与原因（不含令牌）。 */
  readonly #problems = new Map<string, string>();
  #chain: Promise<void> = Promise.resolve();

  private constructor(file: JsonStoreFile, data: NodesFile, credentials: CredentialStore) {
    this.file = file.file;
    this.#file = file;
    this.#data = data;
    this.#credentials = credentials;
  }

  /**
   * 读文件；没有时生成新的 `clientId` 并立即落盘。不是 JSON 或认不出时先改名保留（`<文件>.corrupt-<时间>`）再生成新的；
   * 更新版本写下的或读不了的不改名也不覆盖，这次运行用一个只在内存里的 `clientId`（`store-file.ts`）。
   * 文件里还有旧版本的令牌时迁进凭据存储。
   */
  static async open(path: string, credentials: CredentialStore, log: NodeLogger = silentNodeLog): Promise<NodeStore> {
    const file = new JsonStoreFile(path, log);
    const { value: loaded } = await file.read({ version: { key: 'formatVersion', known: 1 }, recognize: parse, tolerateReadErrors: true });
    const store = new NodeStore(file, loaded ?? { formatVersion: 1, clientId: newClientId(), nodes: [] }, credentials);
    if (!loaded) await store.#save();
    else await store.#migrateTokens(log);
    return store;
  }

  get clientId(): string {
    return this.#data.clientId;
  }

  list(): PairedNodeRecord[] {
    return this.#data.nodes.map(record);
  }

  get(nodeId: string): PairedNodeRecord | null {
    const found = this.#data.nodes.find((n) => n.nodeId === nodeId);
    return found ? record(found) : null;
  }

  /** `nodeId` 或别名 → 记录（`nodeId` 优先）。 */
  resolve(ref: string): PairedNodeRecord | null {
    const found = this.#data.nodes.find((n) => n.nodeId === ref) ?? this.#data.nodes.find((n) => n.alias === ref);
    return found ? record(found) : null;
  }

  /**
   * 这个节点的令牌，只在发请求时取。凭据存储里没有时 null；凭据存储不可用时抛 `CredentialStoreError`，并记下原因
   * （`credentialProblem()`）。
   */
  async token(nodeId: string): Promise<string | null> {
    try {
      const token = await this.#credentials.get(nodeCredentialKey(nodeId));
      this.#problems.delete(nodeId);
      return token;
    } catch (error) {
      this.#problems.set(nodeId, credentialProblem(error).message);
      throw error;
    }
  }

  /** 最近一次读不到这个节点的令牌的原因；没有问题时 null。 */
  credentialProblem(nodeId: string): string | null {
    return this.#problems.get(nodeId) ?? null;
  }

  /** 指定的别名能不能给 `nodeId` 用：不能与别的节点的别名或 `nodeId` 相同。不能用时抛 `conflict`。 */
  checkAlias(alias: string, nodeId: string): void {
    const taken = this.#data.nodes.some((n) => n.nodeId !== nodeId && (n.alias === alias || n.nodeId === alias));
    if (taken) throw new RpcError('conflict', NC.aliasTaken({ alias }));
  }

  /**
   * 配对成功：先把令牌写进凭据存储，再新增或替换这个 `nodeId` 的记录。凭据存储不可用时以 `conflict`
   * （`CREDENTIAL_UNAVAILABLE`）拒绝，记录不变。
   */
  async upsert(
    node: Omit<PairedNodeRecord, 'alias' | 'pairedAt'> & { token: string; alias?: string; pairedAt?: string },
  ): Promise<PairedNodeRecord> {
    const nodes = this.#data.nodes;
    const index = nodes.findIndex((n) => n.nodeId === node.nodeId);
    const previous = index >= 0 ? nodes[index] : undefined;
    let alias: string;
    if (node.alias !== undefined) {
      alias = node.alias.trim();
      if (!alias || alias.length > ALIAS_MAX) throw new RpcError('invalid-request', NC.aliasLength({ max: ALIAS_MAX }));
      this.checkAlias(alias, node.nodeId);
    } else {
      alias = previous?.alias ?? this.#defaultAlias(node.name, node.nodeId);
    }
    await this.#credentialWrite(node.nodeId, () => this.#credentials.set(nodeCredentialKey(node.nodeId), node.token));
    const entry: StoredNode = {
      nodeId: node.nodeId,
      alias,
      name: node.name,
      host: node.host,
      port: node.port,
      pairedAt: node.pairedAt ?? new Date().toISOString(),
    };
    // 写凭据期间别的配对可能改了列表：按 nodeId 重新找位置。
    const at = nodes.findIndex((n) => n.nodeId === node.nodeId);
    if (at >= 0) nodes[at] = entry;
    else nodes.push(entry);
    await this.#save();
    return record(entry);
  }

  /**
   * 删掉本机的记录与令牌；没有这个节点时返回 false。先删令牌：凭据存储不可用时以 `conflict`（`CREDENTIAL_UNAVAILABLE`）
   * 拒绝，记录不变（不留下删不掉的令牌）。
   */
  async remove(nodeId: string): Promise<boolean> {
    if (!this.#data.nodes.some((n) => n.nodeId === nodeId)) return false;
    await this.#credentialWrite(nodeId, () => this.#credentials.delete(nodeCredentialKey(nodeId)));
    const index = this.#data.nodes.findIndex((n) => n.nodeId === nodeId);
    if (index < 0) return false;
    this.#data.nodes.splice(index, 1);
    await this.#save();
    return true;
  }

  flush(): Promise<void> {
    return this.#chain;
  }

  #defaultAlias(name: string, nodeId: string): string {
    const base = name.trim().slice(0, ALIAS_MAX) || 'node';
    const taken = (alias: string) => this.#data.nodes.some((n) => n.nodeId !== nodeId && (n.alias === alias || n.nodeId === alias));
    if (!taken(base)) return base;
    for (let i = 2; ; i++) {
      const suffix = `-${i}`;
      const candidate = `${base.slice(0, ALIAS_MAX - suffix.length)}${suffix}`;
      if (!taken(candidate)) return candidate;
    }
  }

  async #credentialWrite(nodeId: string, write: () => Promise<void>): Promise<void> {
    try {
      await write();
      this.#problems.delete(nodeId);
    } catch (error) {
      const { code, message } = credentialProblem(error);
      throw new RpcError('conflict', NC.tokenNotSaved({ message }), { code: CREDENTIAL_UNAVAILABLE, reason: code, nodeId });
    }
  }

  /** 旧版本写在文件里的令牌：逐个迁进凭据存储，迁成功的从文件里去掉。日志只记 `nodeId` 与原因。 */
  async #migrateTokens(log: NodeLogger): Promise<void> {
    let migrated = 0;
    for (const node of this.#data.nodes) {
      if (node.token === undefined) continue;
      try {
        await this.#credentials.set(nodeCredentialKey(node.nodeId), node.token);
        delete node.token;
        migrated++;
      } catch (error) {
        const { code, message } = credentialProblem(error);
        this.#problems.set(node.nodeId, message);
        log.warn('Node token was not migrated to the credential store; left in the original file', { node: node.nodeId, code, reason: message });
      }
    }
    if (migrated > 0) {
      await this.#save();
      log.info('Migrated node tokens to the credential store', { count: migrated });
    }
  }

  #save(): Promise<void> {
    const snapshot = structuredClone(this.#data);
    const next = this.#chain.then(async () => {
      if (this.#file.readOnly) return this.#file.write(snapshot); // 只记一次 warn，不写。
      await this.#file.write(snapshot, { mode: 0o600 });
      // umask 可能放宽了新文件的权限：改名之后再收紧一次。
      await fs.chmod(this.file, 0o600);
    });
    this.#chain = next.catch(() => {});
    return next;
  }
}

function newClientId(): string {
  return `c_${crypto.randomBytes(16).toString('base64url')}`;
}

/** 对外的记录：没有令牌。 */
function record(node: StoredNode): PairedNodeRecord {
  const { nodeId, alias, name, host, port, pairedAt } = node;
  return { nodeId, alias, name, host, port, pairedAt };
}

function parse(value: Record<string, unknown>): NodesFile | null {
  const data = value as Partial<NodesFile>;
  if (data.formatVersion !== 1 || typeof data.clientId !== 'string' || !CLIENT_ID_PATTERN.test(data.clientId)) return null;
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const valid = nodes.filter(
    (n): n is StoredNode =>
      !!n &&
      typeof n.nodeId === 'string' &&
      typeof n.alias === 'string' &&
      typeof n.name === 'string' &&
      typeof n.host === 'string' &&
      Number.isInteger(n.port) &&
      (n.token === undefined || (typeof n.token === 'string' && n.token !== '')) &&
      typeof n.pairedAt === 'string',
  );
  return {
    formatVersion: 1,
    clientId: data.clientId,
    nodes: valid.map((n) => ({ ...record(n), ...(n.token !== undefined ? { token: n.token } : {}) })),
  };
}
