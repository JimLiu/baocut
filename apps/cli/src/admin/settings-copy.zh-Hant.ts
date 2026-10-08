import type { SettingsMessages } from './settings-copy.ts';

export const zhHant: SettingsMessages = {
  help: `用法：
  baocut settings                  列出所有偏好設定：鍵、目前的值、是否為預設值，以及一行說明
  baocut settings get <key>        印出某項設定目前的值（JSON）
  baocut settings set <key> <value>
                                   變更一項設定；值以 JSON 解析（true、20、{"cjk":18,"other":40}），
                                   無法解析時當作字串。未知的鍵與無效的值會被拒絕，不會儲存任何內容
  baocut settings reset <key>      回復預設值`,
  usage: '用法：baocut settings [get <key> | set <key> <value> | reset <key>]',
  setUsage: '用法：baocut settings set <key> <value>（值以 JSON 解析；不是 JSON 的內容當作字串；含空格的值請加引號）',
  unknownKey: (key: string, keys: readonly string[]) => `未知的設定：${key}。可用的有：${keys.join('、')}`,
  isDefault: '預設值',
  modified: (defaultValue: string) => `已修改（預設值 ${defaultValue}）`,
  settingRejected: (key, value, description) => `${key} 不接受 ${value}：${description}`,
};
