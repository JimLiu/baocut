import type { AgentHostsMessages } from './agent-hosts-copy.ts';

export const it: AgentHostsMessages = {
  missingAgent: (hosts) => `Manca --agent: uno tra ${hosts.join(", ")}`,
  unknownAgent: (value, hosts) => `Agente sconosciuto «${value}»: solo ${hosts.join(", ")}`,
  invalidJson: (file, reason) => `${file} non è JSON valido; non è stato modificato nulla: ${reason}`,
  notObject: (file) => `${file} non ha un oggetto al livello superiore; non è stato modificato nulla`,
};
