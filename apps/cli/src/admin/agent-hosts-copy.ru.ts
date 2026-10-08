import type { AgentHostsMessages } from './agent-hosts-copy.ts';

export const ru: AgentHostsMessages = {
  missingAgent: (hosts) => `Не указан --agent: один из ${hosts.join(", ")}`,
  unknownAgent: (value, hosts) => `Неизвестный агент «${value}»: только ${hosts.join(", ")}`,
  invalidJson: (file, reason) => `${file} — недопустимый JSON; ничего не изменено: ${reason}`,
  notObject: (file) => `Верхний уровень ${file} — не объект; ничего не изменено`,
};
