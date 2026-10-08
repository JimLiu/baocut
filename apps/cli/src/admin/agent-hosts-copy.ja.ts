import type { AgentHostsMessages } from './agent-hosts-copy.ts';

export const ja: AgentHostsMessages = {
  missingAgent: (hosts) => `--agent がありません：${hosts.join('、')} のいずれかを指定してください`,
  unknownAgent: (value, hosts) => `不明な Agent「${value}」：指定できるのは ${hosts.join('、')} だけです`,
  invalidJson: (file, reason) => `${file} は有効な JSON ではありません。何も変更していません：${reason}`,
  notObject: (file) => `${file} の最上位がオブジェクトではありません。何も変更していません`,
};
