import { isDriverId, isMessageRef, type DriverId, type DriverModel, type DriverProbe } from '@baocut/protocol';
import { readJson, writeJsonAtomic } from './json-file.ts';

/**
 * 探测结果里属于「这台机器」的事实（架构设计 §3.11）：装没装、哪个版本、在哪、登没登录、模型表。
 * Driver 这一版的常量（名字、命令、最低版本、安装方式、`verified`、`tested`、能力）不在里面：读回来时由 Driver 的 `describe()` 补，
 * 换了 BaoCut 版本也不会留下旧的常量。
 */
export const DRIVER_PROBE_FACT_KEYS = [
  'state',
  'version',
  'executable',
  'realExecutable',
  'account',
  'accountRef',
  'models',
  'configModel',
  'configModelKnown',
  'latestVersion',
  'detail',
  'detailRef',
  'checkedAt',
] as const satisfies readonly (keyof DriverProbe)[];

export type DriverProbeFacts = Pick<DriverProbe, (typeof DRIVER_PROBE_FACT_KEYS)[number]>;

/** 一条缓存：本机事实，加上探测时用的用户指定可执行文件（与当前偏好不一致时整条作废）。 */
export interface StoredDriverProbe extends DriverProbeFacts {
  executableOverride: string | null;
}

export type StoredDriverProbes = Partial<Record<DriverId, StoredDriverProbe>>;

interface AgentProbesFile {
  schemaVersion: 1;
  drivers: StoredDriverProbes;
}

const STATES = new Set<string>(['ready', 'not-installed', 'outdated', 'signed-out', 'error']);

/** 从探测结果里取出要存的本机事实。 */
export function driverProbeFacts(probe: DriverProbe): DriverProbeFacts {
  const facts = {} as Record<string, unknown>;
  for (const key of DRIVER_PROBE_FACT_KEYS) facts[key] = probe[key];
  return structuredClone(facts) as unknown as DriverProbeFacts;
}

/**
 * Agent 的探测缓存（`<home>/store/agent-probes.json`，架构设计 §3.11）：每个 Driver 最近一次探测的本机事实。
 * Runtime 启动时先拿它给界面，后台重新探测；探测完成一个写一次（整份覆盖，写串行，后一次覆盖前一次）。
 *
 * 只是缓存：文件坏了、字段不对的条目当没有，不拦住 Runtime 启动；没注册的 Driver、可执行文件对不上的条目由调用方丢弃。
 */
export class AgentProbeStore {
  readonly #file: string;
  #saving: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
  }

  async load(): Promise<StoredDriverProbes> {
    const data = await readJson<Partial<AgentProbesFile>>(this.#file).catch(() => null);
    const raw = data && typeof data === 'object' && data.drivers && typeof data.drivers === 'object' ? data.drivers : {};
    const result: StoredDriverProbes = {};
    for (const id of Object.keys(raw).filter(isDriverId)) {
      const entry = normalize((raw as Record<string, unknown>)[id]);
      if (entry) result[id] = entry;
    }
    return result;
  }

  /** 整份写入。写失败只影响下次启动能不能用上缓存：调用方记日志即可。 */
  save(drivers: StoredDriverProbes): Promise<void> {
    const snapshot: AgentProbesFile = { schemaVersion: 1, drivers: structuredClone(drivers) };
    this.#saving = this.#saving.catch(() => {}).then(() => writeJsonAtomic(this.#file, snapshot));
    return this.#saving;
  }

  flush(): Promise<void> {
    return this.#saving.catch(() => {});
  }
}

function normalize(raw: unknown): StoredDriverProbe | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.state !== 'string' || !STATES.has(r.state)) return null;
  if (typeof r.checkedAt !== 'string' || Number.isNaN(Date.parse(r.checkedAt))) return null;
  if (!Array.isArray(r.models) || !r.models.every(isModel)) return null;
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  return {
    state: r.state as StoredDriverProbe['state'],
    version: text(r.version),
    executable: text(r.executable),
    realExecutable: text(r.realExecutable),
    account: text(r.account),
    models: r.models as DriverModel[],
    configModel: text(r.configModel),
    configModelKnown: typeof r.configModelKnown === 'boolean' ? r.configModelKnown : null,
    latestVersion: text(r.latestVersion),
    detail: text(r.detail),
    checkedAt: r.checkedAt,
    executableOverride: typeof r.executableOverride === 'string' && r.executableOverride ? r.executableOverride : null,
    ...(isMessageRef(r.accountRef) ? { accountRef: r.accountRef } : {}),
    ...(isMessageRef(r.detailRef) ? { detailRef: r.detailRef } : {}),
  };
}

function isModel(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    typeof m.label === 'string' &&
    typeof m.isDefault === 'boolean' &&
    Array.isArray(m.efforts) &&
    m.efforts.every((e) => !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string')
  );
}
