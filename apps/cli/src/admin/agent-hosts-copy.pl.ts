import type { AgentHostsMessages } from './agent-hosts-copy.ts';

export const pl: AgentHostsMessages = {
  missingAgent: (hosts) => `Brak --agent: jedna z wartości ${hosts.join(", ")}`,
  unknownAgent: (value, hosts) => `Nieznany agent „${value}”: tylko ${hosts.join(", ")}`,
  invalidJson: (file, reason) => `${file} nie jest prawidłowym JSON; nic nie zmieniono: ${reason}`,
  notObject: (file) => `Najwyższy poziom ${file} nie jest obiektem; nic nie zmieniono`,
};
