import type { AgentHostsMessages } from './agent-hosts-copy.ts';

export const ptBR: AgentHostsMessages = {
  missingAgent: (hosts) => `Falta --agent: um de ${hosts.join(", ")}`,
  unknownAgent: (value, hosts) => `Agente desconhecido “${value}”: somente ${hosts.join(", ")}`,
  invalidJson: (file, reason) => `${file} não é JSON válido; nada foi alterado: ${reason}`,
  notObject: (file) => `${file} não tem um objeto no nível superior; nada foi alterado`,
};
