import { SETTING_DESCRIPTIONS, SETTING_KEYS, isSettingKey, type SettingKey, type SettingsSnapshot } from '@baocut/protocol';
import { M } from './settings-copy.ts';

/**
 * `baocut settings` 的参数与输出（架构设计 §5.10）。从 main.ts 分出来，单独可测。
 * 取值是否合法由 Runtime 判断（`settings.set` 整批校验）；这里只认键名，给出可读的用法错误。
 */

export type SettingsCommand =
  | { kind: 'list' }
  | { kind: 'get'; key: SettingKey }
  | { kind: 'set'; key: SettingKey; value: unknown }
  | { kind: 'reset'; key: SettingKey };

function requireKey(key: string | undefined): SettingKey {
  if (!key) throw new Error(M.usage);
  if (!isSettingKey(key)) throw new Error(M.unknownKey(key, SETTING_KEYS));
  return key;
}

export function parseSettingsArgs(args: string[]): SettingsCommand {
  const [action, key, ...values] = args;
  if (action === undefined || action === 'list') {
    if (key !== undefined) throw new Error(M.usage);
    return { kind: 'list' };
  }
  if (action === 'get' || action === 'reset') {
    if (values.length > 0) throw new Error(M.usage);
    return { kind: action, key: requireKey(key) };
  }
  if (action === 'set') {
    const checked = requireKey(key);
    if (values.length !== 1) throw new Error(M.setUsage);
    return { kind: 'set', key: checked, value: parseSettingValue(values[0]!) };
  }
  throw new Error(M.usage);
}

/** 值按 JSON 解析（`true`、`20`、`null`、`{"cjk":18,"other":40}`）；解析不了就当作字符串（`authorized`、`/Users/me/Downloads`）。 */
export function parseSettingValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** 一个取值的文本：JSON，对象的键按字母排序。 */
export function formatSettingValue(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function canonical(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
  );
}

export function isDefaultValue(view: SettingsSnapshot, key: SettingKey): boolean {
  return formatSettingValue(view.settings[key]) === formatSettingValue(view.defaults[key]);
}

/** 一行：`键  当前值  默认` 或 `键  当前值  已修改（默认 …）`。 */
export function formatSettingLine(view: SettingsSnapshot, key: SettingKey, width = key.length): string {
  const marker = isDefaultValue(view, key) ? M.isDefault : M.modified(formatSettingValue(view.defaults[key]));
  return `${key.padEnd(width)}  ${formatSettingValue(view.settings[key])}  ${marker}`;
}

/** `baocut settings`：全部键，按注册表的顺序，每个键下面一行说明。 */
export function formatSettings(view: SettingsSnapshot): string[] {
  const width = Math.max(...SETTING_KEYS.map((key) => key.length));
  return SETTING_KEYS.flatMap((key) => [formatSettingLine(view, key, width), `  ${SETTING_DESCRIPTIONS[key]}`]);
}
