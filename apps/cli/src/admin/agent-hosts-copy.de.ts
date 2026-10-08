import type { AgentHostsMessages } from './agent-hosts-copy.ts';
export const de: AgentHostsMessages = {
 missingAgent: (hosts) => `--agent fehlt: einer von ${hosts.join(', ')}`,
 unknownAgent: (value, hosts) => `Unbekannter Agent „${value}“: nur ${hosts.join(', ')}`,
 invalidJson: (file, reason) => `${file} enthält kein gültiges JSON; nichts wurde geändert: ${reason}`,
 notObject: (file) => `Die oberste Ebene von ${file} ist kein Objekt; nichts wurde geändert`,
};
