import {
  RpcError,
  SETTING_DEFAULTS,
  SETTING_KEYS,
  type FrozenSettings,
  type SettingKey,
  type SettingSource,
  type SettingValues,
  type SettingsReader,
  type SettingsSnapshot,
  type SettingsView,
} from '@baocut/protocol';
import { settingValueSchemas, settingsPatchSchema } from '@baocut/protocol/schemas';
import { readJson, writeJsonAtomic } from './json-file.ts';
import { RuntimeStorageFiles as SF } from '@baocut/protocol/messages/runtime-storage';

interface SettingsFile {
  schemaVersion: 1;
  /** 只放与默认值不同的取值。不认识的键（更新的版本写下的）原样保留，不生效。 */
  values: Record<string, unknown>;
}

export type SettingsChange = Partial<SettingValues>;

/**
 * Runtime 持有的偏好设置（架构设计 §5.10），文件是 `<runtime-home>/store/settings.json`。
 *
 * - 写入整批校验、串行执行：校验 → 写临时文件再改名 → 换内存 → 通知。写盘失败时内存不变，崩溃不留半份文件。
 * - 文件里不合 schema 的取值（手工改坏的）按默认值处理，不让 Runtime 起不来；文件整个不是合法的 JSON 时启动失败，
 *   与其他 Runtime Store 文件一致。
 */
export class SettingsStore implements SettingsReader {
  readonly #file: string;
  #raw: Record<string, unknown> = {};
  #queue: Promise<unknown> = Promise.resolve();
  readonly #listeners = new Set<(changed: SettingsChange) => void>();

  constructor(file: string) {
    this.#file = file;
  }

  async load(): Promise<void> {
    const data = await readJson<SettingsFile>(this.#file);
    if (data === null) {
      this.#raw = {};
      return;
    }
    if (typeof data !== 'object' || typeof data.values !== 'object' || data.values === null || Array.isArray(data.values)) {
      throw new Error(`Malformed settings file: ${this.#file}`);
    }
    this.#raw = { ...data.values };
  }

  /** 一个键的有效值：用户设过且合 schema 的取值，否则是默认值。 */
  get<K extends SettingKey>(key: K): SettingValues[K] {
    return structuredClone(this.#effective(this.#raw, key));
  }

  /** 全部键（或给出的键）的有效值与默认值。 */
  view(keys?: readonly SettingKey[]): SettingsView {
    const settings: Record<string, unknown> = {};
    const defaults: Record<string, unknown> = {};
    for (const key of keys ?? SETTING_KEYS) {
      settings[key] = this.#effective(this.#raw, key);
      defaults[key] = SETTING_DEFAULTS[key];
    }
    return structuredClone({ settings, defaults }) as SettingsView;
  }

  snapshotAll(): SettingsSnapshot {
    return this.view() as SettingsSnapshot;
  }

  /** 任务创建时冻结它用到的取值与来源（§5.10）。返回的是副本，之后改设置不影响它。 */
  snapshot<K extends SettingKey>(keys: readonly K[]): FrozenSettings<K> {
    const values = {} as Pick<SettingValues, K>;
    const sources = {} as Record<K, SettingSource>;
    for (const key of keys) {
      values[key] = structuredClone(this.#effective(this.#raw, key));
      sources[key] = this.#userValue(this.#raw, key) === undefined ? 'default' : 'user';
    }
    return { values, sources };
  }

  /**
   * 改一组设置。`patch` 整批校验：未知的键或不合 schema 的值以 `invalid-request` 拒绝，什么都不保存。
   * `null` 表示恢复默认值；等于默认值的取值不另存。返回新的完整视图与有效值变了的键。
   */
  set(patch: unknown): Promise<{ snapshot: SettingsSnapshot; changed: SettingsChange }> {
    const run = this.#queue.then(() => this.#apply(patch));
    this.#queue = run.catch(() => {});
    return run;
  }

  /** 有效值变化时通知（写盘之后）；只带变了的键。 */
  onChange(listener: (changed: SettingsChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async #apply(patch: unknown): Promise<{ snapshot: SettingsSnapshot; changed: SettingsChange }> {
    const parsed = settingsPatchSchema.safeParse(patch);
    if (!parsed.success) throw new RpcError('invalid-request', SF.settingsInvalid(), parsed.error.issues);

    const next = { ...this.#raw };
    for (const [key, value] of Object.entries(parsed.data) as [SettingKey, unknown][]) {
      if (value === undefined) continue;
      if (value === null || sameValue(value, SETTING_DEFAULTS[key])) delete next[key];
      else next[key] = value;
    }
    const changed: Record<string, unknown> = {};
    for (const key of SETTING_KEYS) {
      const after = this.#effective(next, key);
      if (!sameValue(this.#effective(this.#raw, key), after)) changed[key] = structuredClone(after);
    }
    if (!sameValue(next, this.#raw)) {
      const file: SettingsFile = { schemaVersion: 1, values: next };
      await writeJsonAtomic(this.#file, file);
    }
    this.#raw = next;
    if (Object.keys(changed).length > 0) {
      for (const listener of this.#listeners) {
        try {
          listener(structuredClone(changed));
        } catch {
          // 订阅方的错误不影响已经落盘的修改。
        }
      }
    }
    return { snapshot: this.snapshotAll(), changed: changed as SettingsChange };
  }

  #userValue<K extends SettingKey>(raw: Record<string, unknown>, key: K): SettingValues[K] | undefined {
    if (!Object.hasOwn(raw, key)) return undefined;
    const checked = settingValueSchemas[key].safeParse(raw[key]);
    return checked.success ? (checked.data as SettingValues[K]) : undefined;
  }

  #effective<K extends SettingKey>(raw: Record<string, unknown>, key: K): SettingValues[K] {
    return this.#userValue(raw, key) ?? SETTING_DEFAULTS[key];
  }
}

/** JSON 值的结构相等（对象不看键的顺序）。 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
