import {
  isDriverId,
  type AgentDriverPreferences,
  type AgentPolicy,
  type AgentPreferences,
  type DriverId,
} from '@baocut/protocol';
import { readJson, writeJsonAtomic } from './json-file.ts';

interface AgentPrefsFile extends AgentPreferences {
  schemaVersion: 1;
}

export const DEFAULT_AGENT_POLICY: AgentPolicy = { read: true, bcutro: true, loop: true };

export const DEFAULT_DRIVER_PREFERENCES: AgentDriverPreferences = {
  enabled: true,
  defaultModel: null,
  defaultEffort: null,
  executable: null,
};

export function defaultAgentPreferences(): AgentPreferences {
  return { drivers: {}, policy: { ...DEFAULT_AGENT_POLICY }, modelAutoUpdate: true, rules: [] };
}

/**
 * Agent 偏好（设置 › Agent 提供方）。整份读进内存，改一次写一次；写串行，后一次覆盖前一次。
 * 文件里不认识或坏掉的字段按默认值处理，不让一个手改坏的文件拦住 Runtime 启动。
 */
export class AgentPrefsStore {
  readonly #file: string;
  #prefs: AgentPreferences = defaultAgentPreferences();
  #saving: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
  }

  async load(): Promise<AgentPreferences> {
    const data = await readJson<Partial<AgentPrefsFile>>(this.#file).catch(() => null);
    this.#prefs = normalize(data ?? {});
    return this.get();
  }

  get(): AgentPreferences {
    return structuredClone(this.#prefs);
  }

  driver(id: DriverId): AgentDriverPreferences {
    return { ...DEFAULT_DRIVER_PREFERENCES, ...this.#prefs.drivers[id] };
  }

  /** 改一份偏好并落盘。`update` 收到的是副本，返回新的完整偏好。 */
  async update(update: (prefs: AgentPreferences) => void): Promise<AgentPreferences> {
    const next = this.get();
    update(next);
    this.#prefs = normalize(next);
    const snapshot: AgentPrefsFile = { schemaVersion: 1, ...this.#prefs };
    this.#saving = this.#saving.catch(() => {}).then(() => writeJsonAtomic(this.#file, snapshot));
    await this.#saving;
    return this.get();
  }

  flush(): Promise<void> {
    return this.#saving;
  }
}

function normalize(data: Partial<AgentPreferences>): AgentPreferences {
  const base = defaultAgentPreferences();
  const drivers: AgentPreferences['drivers'] = {};
  for (const id of Object.keys(data.drivers ?? {}).filter(isDriverId)) {
    const raw = data.drivers?.[id];
    if (!raw || typeof raw !== 'object') continue;
    drivers[id] = {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
      defaultModel: typeof raw.defaultModel === 'string' && raw.defaultModel ? raw.defaultModel : null,
      defaultEffort: typeof raw.defaultEffort === 'string' && raw.defaultEffort ? raw.defaultEffort : null,
      executable: typeof raw.executable === 'string' && raw.executable ? raw.executable : null,
    };
  }
  const policy = { ...base.policy };
  for (const key of Object.keys(policy) as (keyof AgentPolicy)[]) {
    if (typeof data.policy?.[key] === 'boolean') policy[key] = data.policy[key];
  }
  const rules = Array.isArray(data.rules) ? [...new Set(data.rules.filter((r): r is string => typeof r === 'string' && r.length > 0))] : [];
  return {
    drivers,
    policy,
    modelAutoUpdate: typeof data.modelAutoUpdate === 'boolean' ? data.modelAutoUpdate : base.modelAutoUpdate,
    rules,
  };
}
