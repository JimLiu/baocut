import { isBuiltinDriverId, isDriverId, type CustomAgentProvider } from '@baocut/protocol';
import { JsonStoreFile, type StoreOptions } from './store-file.ts';

interface AgentProvidersFile {
  schemaVersion: 1;
  providers: CustomAgentProvider[];
}

/**
 * 用户添加的 ACP 智能体（`<home>/store/agent-providers.json`，架构设计 §3.11），按添加顺序。
 * 整份读进内存，改一次写一次（原子写，写串行，后一次覆盖前一次）；`env` 可能含密钥，文件权限 0600。
 *
 * 文件坏了改名保留、当没有（不拦住 Runtime 启动），更新版本写下的不改写（`store-file.ts`）；单条不合法（id 写法不对、
 * 与内置的或前面的重名、命令为空）的丢掉。
 */
export class AgentProviderStore {
  readonly #file: JsonStoreFile;
  #providers: CustomAgentProvider[] = [];
  #saving: Promise<void> = Promise.resolve();

  constructor(file: string, options: StoreOptions = {}) {
    this.#file = new JsonStoreFile(file, options.log);
  }

  async load(): Promise<CustomAgentProvider[]> {
    const { value } = await this.#file.read({
      recognize: (raw) => (Array.isArray(raw.providers) ? (raw.providers as unknown[]) : null),
      tolerateReadErrors: true,
    });
    const raw = value ?? [];
    const seen = new Set<string>();
    this.#providers = [];
    for (const entry of raw) {
      const provider = normalize(entry);
      if (!provider || seen.has(provider.id)) continue;
      seen.add(provider.id);
      this.#providers.push(provider);
    }
    return this.list();
  }

  list(): CustomAgentProvider[] {
    return structuredClone(this.#providers);
  }

  get(id: string): CustomAgentProvider | null {
    const found = this.#providers.find((p) => p.id === id);
    return found ? structuredClone(found) : null;
  }

  /** 加一条并落盘。id 已存在时抛错（调用方先查）。 */
  async add(provider: CustomAgentProvider): Promise<void> {
    const normalized = normalize(provider);
    if (!normalized) throw new Error(`Invalid agent provider config: ${provider.id}`);
    if (this.#providers.some((p) => p.id === normalized.id)) throw new Error(`Agent provider already exists: ${normalized.id}`);
    this.#providers = [...this.#providers, normalized];
    await this.#save();
  }

  /** 删一条并落盘；没有这一条返回 false，不写文件。 */
  async remove(id: string): Promise<boolean> {
    if (!this.#providers.some((p) => p.id === id)) return false;
    this.#providers = this.#providers.filter((p) => p.id !== id);
    await this.#save();
    return true;
  }

  flush(): Promise<void> {
    return this.#saving.catch(() => {});
  }

  #save(): Promise<void> {
    const snapshot: AgentProvidersFile = {
      schemaVersion: 1,
      providers: structuredClone(this.#providers),
    };
    this.#saving = this.#saving.catch(() => {}).then(() => this.#file.write(snapshot, { mode: 0o600 }));
    return this.#saving;
  }
}

function normalize(raw: unknown): CustomAgentProvider | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isDriverId(r.id) || isBuiltinDriverId(r.id)) return null;
  if (typeof r.name !== 'string' || !r.name.trim()) return null;
  if (!Array.isArray(r.command) || r.command.length === 0 || !r.command.every((a) => typeof a === 'string' && a.length > 0)) return null;
  const env: Record<string, string> = {};
  if (r.env && typeof r.env === 'object') {
    for (const [key, value] of Object.entries(r.env as Record<string, unknown>)) if (typeof value === 'string') env[key] = value;
  }
  return {
    id: r.id,
    name: r.name.trim(),
    command: [...(r.command as string[])],
    ...(Object.keys(env).length ? { env } : {}),
    addedAt: typeof r.addedAt === 'string' && !Number.isNaN(Date.parse(r.addedAt)) ? r.addedAt : new Date(0).toISOString(),
  };
}
