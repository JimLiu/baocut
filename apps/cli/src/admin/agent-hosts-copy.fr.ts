import type { AgentHostsMessages } from './agent-hosts-copy.ts';

export const fr: AgentHostsMessages = {
  missingAgent: (hosts: readonly string[]) => `--agent manquant : choisissez parmi ${hosts.join(", ")}`,
  unknownAgent: (value: string, hosts: readonly string[]) => `Agent inconnu « ${value} » : seuls ${hosts.join(", ")}`,
  invalidJson: (file: string, reason: string) => `${file} n’est pas un JSON valide ; rien n’a été modifié : ${reason}`,
  notObject: (file: string) => `Le premier niveau de ${file} n’est pas un objet ; rien n’a été modifié`,
};
