import type { SettingsMessages } from './settings-copy.ts';

export const ptBR: SettingsMessages = {
  help: `Uso:
  baocut settings                  Listar todas as preferências: chave, valor atual, se é o padrão e uma descrição curta
  baocut settings get <key>        Mostrar o valor atual de uma configuração (JSON)
  baocut settings set <key> <value>
                                   Alterar uma configuração; o valor é interpretado como JSON (true, 20,
                                   {"cjk":18,"other":40}) ou como string se não puder ser interpretado.
                                   Chaves desconhecidas e valores inválidos são rejeitados; nada é salvo
  baocut settings reset <key>      Restaurar o valor padrão`,
  usage: 'Uso: baocut settings [get <key> | set <key> <value> | reset <key>]',
  setUsage: 'Uso: baocut settings set <key> <value> (o valor é interpretado como JSON; o que não for JSON é tratado como string; use aspas em valores com espaços)',
  unknownKey: (key: string, keys: readonly string[]) => `Configuração desconhecida: ${key}. Disponíveis: ${keys.join(', ')}`,
  isDefault: 'padrão',
  modified: (defaultValue: string) => `modificado (padrão ${defaultValue})`,
  settingRejected: (key, value, description) => `${key} não aceita ${value}: ${description}`,
};
