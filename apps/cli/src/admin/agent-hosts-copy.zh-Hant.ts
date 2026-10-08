import type { AgentHostsMessages } from './agent-hosts-copy.ts';

export const zhHant: AgentHostsMessages = {
  missingAgent: (hosts) => `缺少 --agent：應為 ${hosts.join('、')} 其中之一`,
  unknownAgent: (value, hosts) => `未知的 Agent「${value}」：只支援 ${hosts.join('、')}`,
  invalidJson: (file, reason) => `${file} 不是有效的 JSON，未做任何變更：${reason}`,
  notObject: (file) => `${file} 的最上層不是物件，未做任何變更`,
};
