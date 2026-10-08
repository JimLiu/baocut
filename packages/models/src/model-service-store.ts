import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {
  DEFAULT_TEXT_CONCURRENCY,
  MAX_TEXT_CONCURRENCY,
  MODEL_SERVICE_CAPABILITIES,
  RpcError,
  TEXT_EFFORTS,
  type DeclaredModel,
  type ModelRef,
  type ModelServiceCapability,
  type ProviderAccountStatus,
  type ProviderAccountView,
  type ProviderConfigView,
  type ProviderRefreshStatus,
  type SpeechVoice,
  type TextCapabilityParameters,
  type TextEffort,
} from '@baocut/protocol';
import { ModelsModelServiceStore as M } from '@baocut/protocol/messages/models/model-service-store.ts';
import {
  CredentialStoreError,
  credentialProblem,
  providerCredentialKey,
  JsonStoreFile,
  type CredentialStore,
  type StoreLog,
} from '@baocut/runtime-storage';

/**
 * 模型服务配置（架构设计 §6.8）。
 *
 * - `<home>/store/model-services.json`（0600、临时文件加改名、`formatVersion: 2`）：在线 Provider 的开关、启用时间、端点与
 *   （自定义端点的）声明模型、账号（有序）、最近一次向供应商取到的模型与音色列表，每种能力的默认值
 *   `{ providerId, modelId } | null`，以及能力参数的默认值（`generateText` 的推理强度与并发上限）。
 * - 一个 Provider 可以有多个账号（一个账号一把密钥）。密钥经 `CredentialStore` 读写，key 是
 *   `provider:<providerId>/<accountId>`（开发版本在 `model-credentials.json`，正式版本在钥匙串）。配置文件里每个账号只存
 *   写入时算好的掩码（前 3 + … + 后 4；不超过 8 个字符时全是 •），不存密钥。
 * - 选用（§6.2）：一次调用用第一个启用且有密钥的账号（`resolveCredential()`）；失败不换账号。账号的 `status` 只记录最近
 *   一次调用的结果（`recordAccountResult()`），不据此自动换账号。
 * - 迁移：第 1 版的文件里密钥在 `provider:<providerId>`。打开时对每个有旧键的 Provider 建账号 `main`：先写新键
 *   `provider:<providerId>/main`，再写第 2 版的配置文件，最后删旧键（两种后端相同）。凭据存储读不了时记下原因、保留待迁移的
 *   标记（`legacyCredential`），下次打开再试，不当作没有密钥；中途停下时再来一遍结果相同。
 *
 * 读配置的方法只报告 `credential: 'set' | 'missing'` 与账号的掩码；各账号有没有密钥在打开时逐个查一次并记在内存里，密钥本身
 * 只经 `resolveCredential()` 在发请求时取，交给适配器，不缓存。凭据存储不可用时如实报告原因（`credentialProblem()`），
 * 不回退到别的存放。内存里的配置是权威，文件是它的快照；写入串行。默认值指向的 Provider 被删除后照样保留（§6.8）。
 */

/** 一个账号（不含密钥）。 */
export interface StoredAccount {
  accountId: string;
  label: string | null;
  masked: string;
  enabled: boolean;
  region?: string;
  endpoint?: string;
  addedAt: string;
  lastUsedAt?: string;
  status: ProviderAccountStatus;
}

export interface StoredProvider {
  enabled: boolean;
  /** 最近一次启用的时间（启用即是持续的授权，§6.2）；停用时清空。 */
  enabledAt: string | null;
  endpoint?: string;
  label?: string;
  /** 自定义端点声明的模型。 */
  models?: DeclaredModel[];
  /** 最近一次 `models.refreshProvider` 的结果。 */
  discovered?: DiscoveredList;
  /** 账号（有序）。 */
  accounts: StoredAccount[];
  /** 第 1 版的密钥（`provider:<providerId>`）还没迁成账号：上次打开时凭据存储读不了，下次打开再试。 */
  legacyCredential?: true;
}

/**
 * 向供应商取到的列表（§6.8）：`ok` 时有 `models`（供应商的模型 ID）与可选的 `voices`（账号里的音色）；取不到时只记时间
 * 与原因，照旧用内置的列表。
 */
export interface DiscoveredList {
  at: string;
  ok: boolean;
  models?: string[];
  voices?: SpeechVoice[];
  error?: string;
}

interface ServicesFile {
  formatVersion: 2;
  providers: Record<string, StoredProvider>;
  defaults: Partial<Record<ModelServiceCapability, ModelRef | null>>;
  /** 能力参数的默认值；没设的字段用出厂值。 */
  parameters: { generateText?: { effort?: TextEffort; concurrency?: number } };
}

export interface ModelServiceStorePaths {
  modelServicesFile: string;
}

/** 凭据存储读写失败时网关错误的 `details.code`（命令与协议规范 §11）。 */
export const CREDENTIAL_UNAVAILABLE = 'CREDENTIAL_UNAVAILABLE';

/** 账号的密钥在凭据存储里的 key（§6.8）。 */
export function accountCredentialKey(providerId: string, accountId: string): string {
  return `${providerCredentialKey(providerId)}/${accountId}`;
}

/** 密钥的掩码（写入时算一次）：前 3 + … + 后 4；不超过 8 个字符时一律 8 个 •（不透露长度）。 */
export function maskCredential(secret: string): string {
  if (secret.length <= 8) return '••••••••';
  return `${secret.slice(0, 3)}…${secret.slice(-4)}`;
}

/** 迁移与 `models.configure` 建的第一个账号的 id。 */
export const MAIN_ACCOUNT_ID = 'main';
/** `lastUsedAt` 至多这么久落一次盘（状态变化时立即落盘）。 */
const LAST_USED_FLUSH_MS = 60_000;

export interface AccountPatch {
  label?: string | null;
  credential?: string;
  enabled?: boolean;
  region?: string | null;
  endpoint?: string | null;
}

export class ModelServiceStore {
  readonly #file: JsonStoreFile;
  readonly #services: ServicesFile;
  readonly #credentials: CredentialStore;
  /** 有密钥的账号（`<providerId>/<accountId>`；打开时查一次，之后随修改更新）。 */
  readonly #present = new Set<string>();
  /** 查不了或取不到密钥的 Provider 与原因（不含密钥）。 */
  readonly #problems = new Map<string, string>();
  /** 账号状态变化的监听者（`ModelServices` 据此重算视图）。 */
  readonly #listeners = new Set<() => void>();
  /** 各账号最近一次落盘的 `lastUsedAt`（毫秒）。 */
  readonly #flushedUse = new Map<string, number>();
  /** 打开时没能迁移（凭据存储读不了）的 Provider：原因一直报告到下次打开。 */
  readonly #migrationFailed = new Set<string>();
  #chain: Promise<void> = Promise.resolve();

  private constructor(file: JsonStoreFile, services: ServicesFile, credentials: CredentialStore) {
    this.#file = file;
    this.#services = services;
    this.#credentials = credentials;
  }

  /**
   * 读配置文件（没有时从空的配置开始，第一次修改时才写；不是 JSON 或认不出时改名保留、从空开始；更新版本写下的或读不了的
   * 按空处理且不再写它，见 `store-file.ts`），把第 1 版的密钥迁成账号，再向凭据存储逐个查各账号有没有
   * 密钥。查不了时记下原因，不让打开失败。
   *
   * 迁移的顺序（§6.8）：先把密钥写到新键 `provider:<id>/main`，再写第 2 版的配置文件，最后删旧键。写配置失败时不删旧键，
   * 第 1 版的文件与旧键都还在，下次打开重新迁移；旧键删不掉时保留待迁移的标记，下次打开再删（账号已经在，只删旧键）。
   */
  static async open(
    paths: ModelServiceStorePaths,
    credentials: CredentialStore,
    now: () => string = () => new Date().toISOString(),
    options: { log?: StoreLog } = {},
  ): Promise<ModelServiceStore> {
    const file = new JsonStoreFile(paths.modelServicesFile, options.log);
    const { value } = await file.read({
      version: { key: 'formatVersion', known: 2 },
      recognize: (raw) => (raw.formatVersion === 1 || raw.formatVersion === 2 ? raw : null),
      tolerateReadErrors: true,
    });
    const { services, legacy } = parseServices(value);
    const store = new ModelServiceStore(file, services, credentials);
    const pendingDelete: string[] = [];
    let changed = legacy;
    for (const [providerId, provider] of Object.entries(services.providers)) {
      if (!provider.legacyCredential) continue;
      const result = await store.#migrate(providerId, provider, now);
      if (result === 'delete-legacy') pendingDelete.push(providerId);
      if (result !== 'failed') changed = true;
    }
    for (const [providerId, provider] of Object.entries(services.providers)) {
      for (const account of provider.accounts) {
        try {
          if (await credentials.has(accountCredentialKey(providerId, account.accountId))) store.#present.add(presenceKey(providerId, account.accountId));
        } catch (error) {
          store.#problems.set(providerId, credentialProblem(error).message);
        }
      }
    }
    if (!changed) return store;
    try {
      await store.#save();
    } catch {
      return store; // 第 1 版的文件与旧键都还在：下次打开重新迁移。
    }
    let cleared = false;
    for (const providerId of pendingDelete) {
      try {
        await credentials.delete(providerCredentialKey(providerId));
        delete services.providers[providerId]!.legacyCredential;
        cleared = true;
      } catch {
        // 旧键删不掉：保留标记，下次打开再删，不影响使用。
      }
    }
    if (cleared) await store.#save().catch(() => {});
    return store;
  }

  /**
   * 迁一个 Provider 的第 1 版密钥：还没有 `main` 账号时把旧键的密钥写到新键并建账号（掩码由密钥算出）；旧键还在时返回
   * `delete-legacy`，等配置写好再删。没有旧键时去掉标记（没有凭据的 Provider 不建账号）。凭据存储读不了时记下原因、保留
   * 标记，返回 `failed`。
   */
  async #migrate(providerId: string, provider: StoredProvider, now: () => string): Promise<'delete-legacy' | 'done' | 'failed'> {
    try {
      const secret = await this.#credentials.get(providerCredentialKey(providerId));
      if (secret === null) {
        delete provider.legacyCredential;
        return 'done';
      }
      if (!provider.accounts.some((a) => a.accountId === MAIN_ACCOUNT_ID)) {
        await this.#credentials.set(accountCredentialKey(providerId, MAIN_ACCOUNT_ID), secret);
        provider.accounts.unshift(newAccount(MAIN_ACCOUNT_ID, secret, now(), {}));
      }
      return 'delete-legacy';
    } catch (error) {
      this.#problems.set(providerId, credentialProblem(error).message);
      this.#migrationFailed.add(providerId);
      return 'failed';
    }
  }

  /** 配置过的 Provider（含停用的）。 */
  providerIds(): string[] {
    return Object.keys(this.#services.providers);
  }

  provider(providerId: string): StoredProvider | null {
    const found = this.#services.providers[providerId];
    return found ? structuredClone(found) : null;
  }

  /** 有没有至少一个启用且有密钥的账号。 */
  hasCredential(providerId: string): boolean {
    return (this.#services.providers[providerId]?.accounts ?? []).some(
      (a) => a.enabled && this.#present.has(presenceKey(providerId, a.accountId)),
    );
  }

  /** 第一个启用且有密钥的账号（不取密钥；描述与列模型用它的 region 与端点）。 */
  activeAccount(providerId: string): StoredAccount | null {
    const found = (this.#services.providers[providerId]?.accounts ?? []).find(
      (a) => a.enabled && this.#present.has(presenceKey(providerId, a.accountId)),
    );
    return found ? structuredClone(found) : null;
  }

  /** 凭据存储读不了这个 Provider 的密钥时的原因；没有问题时 null。 */
  credentialProblem(providerId: string): string | null {
    return this.#problems.get(providerId) ?? null;
  }

  /** 给适配器的密钥（第一个启用且有密钥的账号的）。见 `resolveCredential()`。 */
  async credential(providerId: string): Promise<string | null> {
    return (await this.resolveCredential(providerId))?.secret ?? null;
  }

  /**
   * 这次调用用的账号与密钥（§6.2）：按顺序取第一个启用且有密钥的账号；一个也没有时 null。只在发请求时取，不缓存到别处。
   * 凭据存储不可用时抛 `CredentialStoreError` 并记下原因（之后的视图报告它）；成功时清掉原来记下的问题。
   */
  async resolveCredential(providerId: string): Promise<{ accountId: string; secret: string } | null> {
    const accounts = (this.#services.providers[providerId]?.accounts ?? []).filter((a) => a.enabled);
    try {
      for (const account of accounts) {
        const secret = await this.#credentials.get(accountCredentialKey(providerId, account.accountId));
        const key = presenceKey(providerId, account.accountId);
        if (secret === null) {
          this.#present.delete(key);
          continue;
        }
        this.#present.add(key);
        if (!this.#migrationFailed.has(providerId)) this.#problems.delete(providerId);
        return { accountId: account.accountId, secret };
      }
      // 第 1 版的密钥还没迁过来（凭据存储读不了）：是凭据不可用，不是没有密钥（§6.8）。
      if (this.#migrationFailed.has(providerId)) {
        throw new CredentialStoreError('unavailable', this.#problems.get(providerId) ?? M.notMigrated().text);
      }
      this.#problems.delete(providerId);
      return null;
    } catch (error) {
      if (error instanceof CredentialStoreError && this.#migrationFailed.has(providerId)) throw error;
      this.#problems.set(providerId, credentialProblem(error).message);
      throw error;
    }
  }

  /** 一个账号的密钥（验证已保存的密钥时用）；没有时 null。凭据存储不可用时抛 `CredentialStoreError` 并记下原因。 */
  async accountCredential(providerId: string, accountId: string): Promise<string | null> {
    try {
      return await this.#credentials.get(accountCredentialKey(providerId, accountId));
    } catch (error) {
      this.#problems.set(providerId, credentialProblem(error).message);
      throw error;
    }
  }

  /** 只读视图：密钥只报告有没有，账号只有掩码。 */
  configView(providerId: string): ProviderConfigView {
    const stored = this.#services.providers[providerId];
    return {
      enabled: stored?.enabled ?? false,
      enabledAt: stored?.enabledAt ?? null,
      credential: this.hasCredential(providerId) ? 'set' : 'missing',
      accounts: (stored?.accounts ?? []).map((a) => this.#accountView(providerId, a)),
      ...(stored?.endpoint ? { endpoint: stored.endpoint } : {}),
      ...(stored?.discovered ? { refreshed: refreshStatus(stored.discovered) } : {}),
    };
  }

  #accountView(providerId: string, account: StoredAccount): ProviderAccountView {
    return {
      accountId: account.accountId,
      label: account.label,
      masked: account.masked,
      enabled: account.enabled,
      ...(account.region ? { region: account.region } : {}),
      ...(account.endpoint ? { endpoint: account.endpoint } : {}),
      addedAt: account.addedAt,
      ...(account.lastUsedAt ? { lastUsedAt: account.lastUsedAt } : {}),
      credential: this.#present.has(presenceKey(providerId, account.accountId)) ? 'set' : 'missing',
      status: { ...account.status },
    };
  }

  /** 账号状态变化时通知（只在 `status.state` 变了时，`lastUsedAt` 不算）。 */
  onAccountChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 记下一次刷新的结果（成功时替换列表，失败时丢掉旧列表、照旧用内置的）。Provider 还没有配置过时建一条停用的。 */
  async setDiscovered(providerId: string, discovered: DiscoveredList): Promise<ProviderRefreshStatus> {
    const current = this.#services.providers[providerId] ?? emptyProvider();
    this.#services.providers[providerId] = { ...current, discovered: structuredClone(discovered) };
    await this.#save();
    return refreshStatus(discovered);
  }

  /** `generateText` 的参数默认值，补上出厂值。 */
  textParameters(): TextCapabilityParameters {
    const stored = this.#services.parameters.generateText ?? {};
    return { effort: stored.effort ?? null, concurrency: stored.concurrency ?? DEFAULT_TEXT_CONCURRENCY };
  }

  /** 改 `generateText` 的参数默认值：null 恢复出厂值，undefined 不变。 */
  async setTextParameters(patch: { effort?: TextEffort | null; concurrency?: number | null }): Promise<TextCapabilityParameters> {
    const next = { ...this.#services.parameters.generateText };
    if (patch.effort === null) delete next.effort;
    else if (patch.effort !== undefined) next.effort = patch.effort;
    if (patch.concurrency === null) delete next.concurrency;
    else if (patch.concurrency !== undefined) next.concurrency = patch.concurrency;
    this.#services.parameters.generateText = next;
    await this.#save();
    return this.textParameters();
  }

  /**
   * 修改一个 Provider 的配置。`enabled: true` 记下 `enabledAt`（已启用的保持原值），`false` 清空它；`endpoint: null` 删除
   * 改写的端点。`credential`（兼容 `models.configure` 与 CLI）为字符串时写进第一个账号（没有账号时建 `main`），null 时删掉
   * 第一个账号，undefined 不变。先写凭据：凭据存储不可用时以 `conflict`（`CREDENTIAL_UNAVAILABLE`）拒绝，配置不变。
   */
  async updateProvider(
    providerId: string,
    patch: {
      enabled?: boolean;
      credential?: string | null;
      endpoint?: string | null;
      label?: string;
      models?: DeclaredModel[];
    },
    now: () => string = () => new Date().toISOString(),
  ): Promise<void> {
    const current = this.#services.providers[providerId] ?? emptyProvider();
    const next: StoredProvider = { ...current, accounts: current.accounts.map((a) => ({ ...a })) };
    if (patch.credential !== undefined) {
      const first = next.accounts[0];
      if (patch.credential === null) {
        if (first) {
          await this.#credentialWrite(providerId, () => this.#credentials.delete(accountCredentialKey(providerId, first.accountId)));
          this.#present.delete(presenceKey(providerId, first.accountId));
          next.accounts.shift();
        }
      } else {
        const accountId = first?.accountId ?? this.#freshAccountId(next, MAIN_ACCOUNT_ID);
        const secret = patch.credential;
        await this.#credentialWrite(providerId, () => this.#credentials.set(accountCredentialKey(providerId, accountId), secret));
        this.#present.add(presenceKey(providerId, accountId));
        if (first) Object.assign(first, { masked: maskCredential(secret), status: { state: 'unknown' } });
        else next.accounts.push(newAccount(accountId, secret, now(), {}));
      }
    }
    if (patch.enabled === true && !current.enabled) Object.assign(next, { enabled: true, enabledAt: now() });
    if (patch.enabled === false) Object.assign(next, { enabled: false, enabledAt: null });
    if (patch.endpoint === null) delete next.endpoint;
    else if (patch.endpoint !== undefined) next.endpoint = patch.endpoint;
    if (patch.label !== undefined) next.label = patch.label;
    if (patch.models !== undefined) next.models = structuredClone(patch.models);
    this.#services.providers[providerId] = next;
    await this.#save();
  }

  /**
   * 加一个账号（加在最后），返回它的 id。Provider 还没有配置过时建一条（不改开关）。先写凭据：凭据存储不可用时以
   * `conflict`（`CREDENTIAL_UNAVAILABLE`）拒绝，配置不变。
   */
  async addAccount(
    providerId: string,
    input: { credential: string; label?: string; region?: string; endpoint?: string },
    now: () => string = () => new Date().toISOString(),
  ): Promise<string> {
    const current = this.#services.providers[providerId] ?? emptyProvider();
    const accountId = current.accounts.length === 0 ? this.#freshAccountId(current, MAIN_ACCOUNT_ID) : this.#freshAccountId(current);
    await this.#credentialWrite(providerId, () => this.#credentials.set(accountCredentialKey(providerId, accountId), input.credential));
    this.#present.add(presenceKey(providerId, accountId));
    const account = newAccount(accountId, input.credential, now(), input);
    this.#services.providers[providerId] = { ...current, accounts: [...current.accounts, account] };
    await this.#save();
    return accountId;
  }

  /** 改一个账号；没有这个账号时 `not-found`。换密钥时先写凭据，状态回到 `unknown`。 */
  async updateAccount(providerId: string, accountId: string, patch: AccountPatch): Promise<void> {
    const provider = this.#services.providers[providerId];
    const index = provider?.accounts.findIndex((a) => a.accountId === accountId) ?? -1;
    if (!provider || index < 0) throw accountNotFound(providerId, accountId);
    const next: StoredAccount = { ...provider.accounts[index]! };
    if (patch.credential !== undefined) {
      const secret = patch.credential;
      await this.#credentialWrite(providerId, () => this.#credentials.set(accountCredentialKey(providerId, accountId), secret));
      this.#present.add(presenceKey(providerId, accountId));
      next.masked = maskCredential(secret);
      next.status = { state: 'unknown' };
    }
    if (patch.label !== undefined) next.label = patch.label;
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.region === null) delete next.region;
    else if (patch.region !== undefined) next.region = patch.region;
    if (patch.endpoint === null) delete next.endpoint;
    else if (patch.endpoint !== undefined) next.endpoint = patch.endpoint;
    const accounts = [...provider.accounts];
    accounts[index] = next;
    this.#services.providers[providerId] = { ...provider, accounts };
    await this.#save();
  }

  /** 删一个账号与它的密钥（先删凭据）。没有这个账号时 `not-found`。删掉最后一个账号不移除 Provider。 */
  async removeAccount(providerId: string, accountId: string): Promise<void> {
    const provider = this.#services.providers[providerId];
    if (!provider?.accounts.some((a) => a.accountId === accountId)) throw accountNotFound(providerId, accountId);
    await this.#credentialWrite(providerId, () => this.#credentials.delete(accountCredentialKey(providerId, accountId)));
    this.#present.delete(presenceKey(providerId, accountId));
    this.#services.providers[providerId] = { ...provider, accounts: provider.accounts.filter((a) => a.accountId !== accountId) };
    await this.#save();
  }

  /** 账号的新顺序：要恰好是现有账号的一个排列，否则 `invalid-request`。 */
  async arrangeAccounts(providerId: string, order: string[]): Promise<void> {
    const provider = this.#services.providers[providerId] ?? emptyProvider();
    const byId = new Map(provider.accounts.map((a) => [a.accountId, a]));
    if (order.length !== byId.size || new Set(order).size !== order.length || order.some((id) => !byId.has(id))) {
      throw new RpcError('invalid-request', M.orderMismatch(), { accounts: [...byId.keys()] });
    }
    this.#services.providers[providerId] = { ...provider, accounts: order.map((id) => byId.get(id)!) };
    await this.#save();
  }

  /**
   * 记下一次调用的结果（§6.2：只记录，不换账号）：`status` 为 null 时只更新 `lastUsedAt`（例如与密钥无关的失败）。
   * 状态变化时立即落盘并通知监听者；`lastUsedAt` 至多每分钟落一次盘。账号已经不在时什么也不做。
   */
  recordAccountResult(providerId: string, accountId: string, at: string, status: ProviderAccountStatus | null): void {
    const account = this.#services.providers[providerId]?.accounts.find((a) => a.accountId === accountId);
    if (!account) return;
    account.lastUsedAt = at;
    const changed = status !== null && JSON.stringify(status) !== JSON.stringify(account.status);
    const stateChanged = status !== null && status.state !== account.status.state;
    if (status !== null) account.status = { ...status };
    const key = presenceKey(providerId, accountId);
    const atMs = Date.parse(at);
    if (changed || !(atMs - (this.#flushedUse.get(key) ?? 0) < LAST_USED_FLUSH_MS)) {
      this.#flushedUse.set(key, atMs);
      void this.#save().catch(() => {});
    }
    if (stateChanged) for (const listener of this.#listeners) listener();
  }

  /**
   * 删除一个 Provider 的配置与它全部账号的密钥（还有第 1 版留下的旧键）。指向它的默认值保留。没有时返回 false。
   * 先删凭据：凭据存储不可用时以 `conflict`（`CREDENTIAL_UNAVAILABLE`）拒绝，配置不变（不留下删不掉的密钥；已经删掉的账号
   * 从配置里去掉，再删一次接着删剩下的）。
   */
  async removeProvider(providerId: string): Promise<boolean> {
    const provider = this.#services.providers[providerId];
    if (!provider) return false;
    for (const account of [...provider.accounts]) {
      try {
        await this.#credentialWrite(providerId, () => this.#credentials.delete(accountCredentialKey(providerId, account.accountId)));
      } catch (error) {
        await this.#save().catch(() => {});
        throw error;
      }
      this.#present.delete(presenceKey(providerId, account.accountId));
      provider.accounts = provider.accounts.filter((a) => a.accountId !== account.accountId);
    }
    await this.#credentialWrite(providerId, () => this.#credentials.delete(providerCredentialKey(providerId)));
    this.#problems.delete(providerId);
    delete this.#services.providers[providerId];
    await this.#save();
    return true;
  }

  getDefault(capability: ModelServiceCapability): ModelRef | null {
    const found = this.#services.defaults[capability];
    return found ? { ...found } : null;
  }

  async setDefault(capability: ModelServiceCapability, ref: ModelRef | null): Promise<void> {
    this.#services.defaults[capability] = ref ? { providerId: ref.providerId, modelId: ref.modelId } : null;
    await this.#save();
  }

  /** 等待排队的写入（测试与停止时用）。 */
  flush(): Promise<void> {
    return this.#chain;
  }

  /** 新账号的 id：给了偏好且没被占用时用它，否则随机 8 位十六进制。 */
  #freshAccountId(provider: StoredProvider, preferred?: string): string {
    const taken = new Set(provider.accounts.map((a) => a.accountId));
    if (preferred && !taken.has(preferred)) return preferred;
    for (;;) {
      const id = crypto.randomBytes(4).toString('hex');
      if (!taken.has(id)) return id;
    }
  }

  async #credentialWrite(providerId: string, write: () => Promise<void>): Promise<void> {
    try {
      await write();
      this.#problems.delete(providerId);
    } catch (error) {
      const { code, message } = credentialProblem(error);
      throw new RpcError('conflict', M.credentialNotSaved({ reason: message }), { code: CREDENTIAL_UNAVAILABLE, reason: code, providerId });
    }
  }

  #save(): Promise<void> {
    const services = structuredClone(this.#services);
    // 没有账号的 Provider（智能体 Provider、还没加密钥的服务商）不写 `accounts`。
    for (const provider of Object.values(services.providers)) {
      if (provider.accounts.length === 0) delete (provider as Partial<StoredProvider>).accounts;
    }
    const next = this.#chain.then(() => writePrivate(this.#file, services));
    this.#chain = next.catch(() => {});
    return next;
  }
}

async function writePrivate(file: JsonStoreFile, value: unknown): Promise<void> {
  if (file.readOnly) return file.write(value); // 只记一次 warn，不写。
  await file.write(value, { mode: 0o600 });
  // umask 可能放宽了新文件的权限：改名之后再收紧一次。
  await fs.chmod(file.file, 0o600);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function accountNotFound(providerId: string, accountId: string): RpcError {
  return new RpcError('not-found', M.accountNotFound({ provider: providerId, account: accountId }), {
    code: 'ACCOUNT_NOT_FOUND',
    providerId,
    accountId,
  });
}

function emptyProvider(): StoredProvider {
  return { enabled: false, enabledAt: null, accounts: [] };
}

function presenceKey(providerId: string, accountId: string): string {
  return `${providerId}/${accountId}`;
}

function newAccount(
  accountId: string,
  secret: string,
  at: string,
  input: { label?: string; region?: string; endpoint?: string },
): StoredAccount {
  return {
    accountId,
    label: input.label ?? null,
    masked: maskCredential(secret),
    enabled: true,
    ...(input.region ? { region: input.region } : {}),
    ...(input.endpoint ? { endpoint: input.endpoint } : {}),
    addedAt: at,
    status: { state: 'unknown' },
  };
}

const ACCOUNT_STATES = new Set(['ok', 'invalid-key', 'rate-limited', 'quota-exhausted', 'unknown']);

function parseAccount(raw: unknown): StoredAccount | null {
  if (!isObject(raw) || typeof raw.accountId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(raw.accountId)) return null;
  if (typeof raw.masked !== 'string' || typeof raw.addedAt !== 'string') return null;
  const status: ProviderAccountStatus = { state: 'unknown' };
  if (isObject(raw.status) && typeof raw.status.state === 'string' && ACCOUNT_STATES.has(raw.status.state)) {
    status.state = raw.status.state as ProviderAccountStatus['state'];
    for (const field of ['at', 'until', 'detail'] as const) if (typeof raw.status[field] === 'string') status[field] = raw.status[field];
  }
  return {
    accountId: raw.accountId,
    label: typeof raw.label === 'string' ? raw.label : null,
    masked: raw.masked,
    enabled: raw.enabled !== false,
    ...(typeof raw.region === 'string' ? { region: raw.region } : {}),
    ...(typeof raw.endpoint === 'string' ? { endpoint: raw.endpoint } : {}),
    addedAt: raw.addedAt,
    ...(typeof raw.lastUsedAt === 'string' ? { lastUsedAt: raw.lastUsedAt } : {}),
    status,
  };
}

/** 读第 1、2 版的文件。第 1 版的每个 Provider 都标为待迁移（`legacy` 为 true 表示文件要换成第 2 版）。 */
function parseServices(value: unknown): { services: ServicesFile; legacy: boolean } {
  const empty: ServicesFile = { formatVersion: 2, providers: {}, defaults: {}, parameters: {} };
  if (!isObject(value) || (value.formatVersion !== 1 && value.formatVersion !== 2)) return { services: empty, legacy: false };
  const legacy = value.formatVersion === 1;
  const providers: Record<string, StoredProvider> = {};
  if (isObject(value.providers)) {
    for (const [id, raw] of Object.entries(value.providers)) {
      if (!isObject(raw) || typeof raw.enabled !== 'boolean') continue;
      const entry: StoredProvider = {
        enabled: raw.enabled,
        enabledAt: raw.enabled && typeof raw.enabledAt === 'string' ? raw.enabledAt : null,
        accounts: [],
      };
      if (typeof raw.endpoint === 'string') entry.endpoint = raw.endpoint;
      if (typeof raw.label === 'string') entry.label = raw.label;
      if (Array.isArray(raw.models)) {
        entry.models = raw.models.filter((m): m is DeclaredModel => isObject(m) && typeof m.modelId === 'string' && m.modelId !== '');
      }
      const discovered = parseDiscovered(raw.discovered);
      if (discovered) entry.discovered = discovered;
      if (!legacy && Array.isArray(raw.accounts)) {
        const seen = new Set<string>();
        for (const candidate of raw.accounts) {
          const account = parseAccount(candidate);
          if (account && !seen.has(account.accountId)) {
            seen.add(account.accountId);
            entry.accounts.push(account);
          }
        }
      }
      if (legacy || raw.legacyCredential === true) entry.legacyCredential = true;
      providers[id] = entry;
    }
  }
  const defaults: ServicesFile['defaults'] = {};
  if (isObject(value.defaults)) {
    for (const capability of MODEL_SERVICE_CAPABILITIES) {
      const ref = value.defaults[capability];
      if (isObject(ref) && typeof ref.providerId === 'string' && typeof ref.modelId === 'string') {
        defaults[capability] = { providerId: ref.providerId, modelId: ref.modelId };
      }
    }
  }
  const parameters: ServicesFile['parameters'] = {};
  const text = isObject(value.parameters) ? value.parameters.generateText : undefined;
  if (isObject(text)) {
    const stored: { effort?: TextEffort; concurrency?: number } = {};
    if ((TEXT_EFFORTS as readonly unknown[]).includes(text.effort)) stored.effort = text.effort as TextEffort;
    const concurrency = text.concurrency;
    if (typeof concurrency === 'number' && Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= MAX_TEXT_CONCURRENCY) {
      stored.concurrency = concurrency;
    }
    parameters.generateText = stored;
  }
  return { services: { formatVersion: 2, providers, defaults, parameters }, legacy };
}

function parseDiscovered(value: unknown): DiscoveredList | null {
  if (!isObject(value) || typeof value.at !== 'string' || typeof value.ok !== 'boolean') return null;
  const list: DiscoveredList = { at: value.at, ok: value.ok };
  if (typeof value.error === 'string') list.error = value.error;
  if (value.ok && Array.isArray(value.models)) list.models = value.models.filter((m): m is string => typeof m === 'string' && m !== '');
  if (value.ok && Array.isArray(value.voices)) {
    list.voices = value.voices.filter(
      (v): v is SpeechVoice => isObject(v) && typeof v.voiceId === 'string' && v.voiceId !== '' && typeof v.label === 'string',
    );
  }
  return list;
}

function refreshStatus(discovered: DiscoveredList): ProviderRefreshStatus {
  return {
    at: discovered.at,
    ok: discovered.ok,
    ...(discovered.models ? { models: discovered.models.length } : {}),
    ...(discovered.voices ? { voices: discovered.voices.length } : {}),
    ...(discovered.error ? { error: discovered.error } : {}),
  };
}
