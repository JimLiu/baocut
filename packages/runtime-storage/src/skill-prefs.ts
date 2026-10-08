import { SKILL_ID_PATTERN } from '@baocut/protocol';
import { readJson, writeJsonAtomic } from './json-file.ts';

/** skill 开关的存储形态：`enabled` 只放用户改过、与来源默认值不同的那些。 */
export interface SkillPrefs {
  enabled: Record<string, boolean>;
}

interface SkillPrefsFile extends SkillPrefs {
  schemaVersion: 1;
}

/**
 * Agent skill 的开关（架构设计 §3.8）。只存相对来源默认值的差量：默认值以后改了，用户没动过的 skill 跟着新默认走。
 * 整份读进内存，改一次写一次；写串行。文件里不认识或坏掉的条目丢掉，不拦住 Runtime 启动。
 */
export class SkillPrefsStore {
  readonly #file: string;
  #prefs: SkillPrefs = { enabled: {} };
  #saving: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
  }

  async load(): Promise<SkillPrefs> {
    const data = await readJson<Partial<SkillPrefsFile>>(this.#file).catch(() => null);
    this.#prefs = normalize(data ?? {});
    return this.get();
  }

  get(): SkillPrefs {
    return structuredClone(this.#prefs);
  }

  /** 用户设的开关；没设过时为 undefined（用来源的默认值）。 */
  override(id: string): boolean | undefined {
    return Object.hasOwn(this.#prefs.enabled, id) ? this.#prefs.enabled[id] : undefined;
  }

  /** 记下一个开关：等于默认值时删掉差量。 */
  set(id: string, enabled: boolean, defaultEnabled: boolean): Promise<SkillPrefs> {
    return this.#update((prefs) => {
      if (enabled === defaultEnabled) delete prefs.enabled[id];
      else prefs.enabled[id] = enabled;
    });
  }

  /** 移除 skill 时一并忘掉它的开关。没有记录时不写盘。 */
  async forget(id: string): Promise<SkillPrefs> {
    if (!Object.hasOwn(this.#prefs.enabled, id)) return this.get();
    return this.#update((prefs) => {
      delete prefs.enabled[id];
    });
  }

  flush(): Promise<void> {
    return this.#saving;
  }

  async #update(update: (prefs: SkillPrefs) => void): Promise<SkillPrefs> {
    const next = this.get();
    update(next);
    this.#prefs = normalize(next);
    const snapshot: SkillPrefsFile = { schemaVersion: 1, ...this.#prefs };
    this.#saving = this.#saving.catch(() => {}).then(() => writeJsonAtomic(this.#file, snapshot));
    await this.#saving;
    return this.get();
  }
}

function normalize(data: Partial<SkillPrefs>): SkillPrefs {
  const enabled: Record<string, boolean> = {};
  const raw = data.enabled;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, value] of Object.entries(raw)) {
      if (typeof value === 'boolean' && SKILL_ID_PATTERN.test(id)) enabled[id] = value;
    }
  }
  return { enabled };
}
