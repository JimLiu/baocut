import type { AgentCatalogMessages } from './agent-catalog.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: AgentCatalogMessages = {
  idEmpty: "Insira um id, por exemplo my-agent",
  idPattern: "O id deve começar com uma letra minúscula e usar apenas letras minúsculas, dígitos e hífens",
  idTooLong: "O id pode ter no máximo 63 caracteres",
  idBuiltin: (id: string, who: string | null) => `“${id}” é o id de um agente integrado ao BaoCut${who ? ` (${who})` : ""}. Escolha outro id`,
  idTaken: (id: string, who: string | null) => `Um agente já usa “${id}”${who ? ` (${who})` : ""}. Escolha outro id`,
  nameEmpty: "Insira um nome para mostrar na lista",
  nameTooLong: (max: number) => pluralForm('pt-BR', max, { one: `O nome pode ter no máximo ${max} caractere`, other: `O nome pode ter no máximo ${max} caracteres` }),
  commandEmpty: "Insira o comando que o inicia, por exemplo my-agent --acp",
  commandShell: "Insira um único comando: o BaoCut o inicia diretamente, sem shell, então pipes, redirecionamentos e && não funcionam",
  tooManyArgs: (max: number) => `Argumentos demais: até ${max}`,
  envLine: (line: number) => `Linha ${line} deve ser KEY=VALUE, com KEY começando com uma letra ou sublinhado`,
};
