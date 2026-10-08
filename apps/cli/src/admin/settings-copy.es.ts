import type { SettingsMessages } from './settings-copy.ts';
export const es: SettingsMessages = {
 help: `Uso:
  baocut settings                  Listar todas las preferencias: clave, valor actual, si es el predeterminado y una descripción breve
  baocut settings get <key>        Imprimir el valor actual de un ajuste (JSON)
  baocut settings set <key> <value>
                                   Cambiar un ajuste; el valor se analiza como JSON (true, 20,
                                   {"cjk":18,"other":40}) o se toma como cadena si no se puede analizar.
                                   Las claves desconocidas y los valores no válidos se rechazan sin guardar nada
  baocut settings reset <key>      Restaurar el valor predeterminado`,
 usage: 'Uso: baocut settings [get <key> | set <key> <value> | reset <key>]',
 setUsage: 'Uso: baocut settings set <key> <value> (el valor se analiza como JSON; lo que no sea JSON se toma como cadena; entrecomilla valores que contengan espacios)',
 unknownKey: (key, keys) => `Ajuste desconocido: ${key}. Disponibles: ${keys.join(', ')}`, isDefault: 'predeterminado', modified: (defaultValue) => `modificado (predeterminado ${defaultValue})`, settingRejected: (key, value, description) => `${key} no acepta ${value}: ${description}`,
};
