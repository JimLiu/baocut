import type { AgentHostsMessages } from './agent-hosts-copy.ts';
export const es: AgentHostsMessages = {
 missingAgent: (hosts) => `Falta --agent: uno de ${hosts.join(', ')}`, unknownAgent: (value, hosts) => `Agente «${value}» desconocido: solo ${hosts.join(', ')}`, invalidJson: (file, reason) => `${file} no es JSON válido; no se cambió nada: ${reason}`, notObject: (file) => `El nivel superior de ${file} no es un objeto; no se cambió nada`,
};
