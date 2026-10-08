import type { SettingsMessages } from './settings-copy.ts';

export const ja: SettingsMessages = {
  help: `使い方：
  baocut settings                  すべての環境設定を一覧表示：キー、現在の値、既定かどうか、1 行の説明
  baocut settings get <key>        設定の現在の値を表示（JSON）
  baocut settings set <key> <value>
                                   設定を変更。値は JSON として解析し（true、20、
                                   {"cjk":18,"other":40}）、解析できなければ文字列として扱います。
                                   不明なキーや無効な値は拒否し、何も保存しません
  baocut settings reset <key>      既定の値に戻す`,
  usage: '使い方：baocut settings [get <key> | set <key> <value> | reset <key>]',
  setUsage:
    '使い方：baocut settings set <key> <value>（値は JSON として解析し、JSON でなければ文字列として扱います。空白を含む値は引用符で囲んでください）',
  unknownKey: (key: string, keys: readonly string[]) => `不明な設定：${key}。使えるのは ${keys.join('、')} です`,
  isDefault: '既定',
  modified: (defaultValue: string) => `変更済み（既定 ${defaultValue}）`,
  settingRejected: (key, value, description) => `${key} には ${value} を指定できません：${description}`,
};
