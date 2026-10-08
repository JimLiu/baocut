import type { AgentHostsMessages } from './agent-hosts-copy.ts';

export const zhHans: AgentHostsMessages = {
  missingAgent: (hosts) => `缺少 --agent：${hosts.join('、')} 之一`,
  unknownAgent: (value, hosts) => `不认识的宿主「${value}」：只有 ${hosts.join('、')}`,
  invalidJson: (file, reason) => `${file} 不是合法的 JSON，没有改动：${reason}`,
  notObject: (file) => `${file} 的顶层不是对象，没有改动`,
};
