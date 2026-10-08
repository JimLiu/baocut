import type { SettingsMessages } from './settings-copy.ts';

export const zhHans: SettingsMessages = {
  help: `用法：
  baocut settings                  列出全部偏好设置：键、当前值、是否默认，以及一句说明
  baocut settings get <键>         打印一个设置的当前值（JSON）
  baocut settings set <键> <值>    改一个设置；值按 JSON 解析（true、20、{"cjk":18,"other":40}），解析不了就当作字符串
                                   不认识的键与不合规定的值被拒绝，什么都不保存
  baocut settings reset <键>       恢复默认值`,
  usage: '用法：baocut settings [get <键> | set <键> <值> | reset <键>]',
  setUsage: '用法：baocut settings set <键> <值>（值按 JSON 解析，解析不了就当作字符串；含空格时加引号）',
  unknownKey: (key: string, keys: readonly string[]) => `不认识的设置项：${key}。可用的有：${keys.join('、')}`,
  isDefault: '默认',
  modified: (defaultValue: string) => `已修改（默认 ${defaultValue}）`,
  settingRejected: (key, value, description) => `${key} 不接受 ${value}：${description}`,
};
