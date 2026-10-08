import type { AgentHostsMessages } from './agent-hosts-copy.ts';

export const ko: AgentHostsMessages = {
  missingAgent: (hosts) => `--agent가 없습니다: ${hosts.join(', ')} 중 하나를 지정하세요`,
  unknownAgent: (value, hosts) => `알 수 없는 Agent “${value}”: ${hosts.join(', ')}만 가능합니다`,
  invalidJson: (file, reason) => `${file} 파일이 올바른 JSON이 아니어서 아무것도 변경하지 않았습니다: ${reason}`,
  notObject: (file) => `${file} 파일의 최상위가 객체가 아니어서 아무것도 변경하지 않았습니다`,
};
