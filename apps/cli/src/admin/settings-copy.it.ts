import type { SettingsMessages } from './settings-copy.ts';

export const it: SettingsMessages = {
  help: `Uso:
  baocut settings                  Elenca tutte le preferenze: chiave, valore attuale, se è predefinito e una breve descrizione
  baocut settings get <key>        Mostra il valore attuale di un’impostazione (JSON)
  baocut settings set <key> <value>
                                   Modifica un’impostazione; il valore viene interpretato come JSON (true, 20,
                                   {"cjk":18,"other":40}) o come stringa se non può essere interpretato.
                                   Le chiavi sconosciute e i valori non validi vengono rifiutati; nulla viene salvato
  baocut settings reset <key>      Ripristina il valore predefinito`,
  usage: 'Uso: baocut settings [get <key> | set <key> <value> | reset <key>]',
  setUsage: 'Uso: baocut settings set <key> <value> (il valore viene interpretato come JSON; ciò che non è JSON viene trattato come stringa; racchiudi tra virgolette i valori con spazi)',
  unknownKey: (key: string, keys: readonly string[]) => `Impostazione sconosciuta: ${key}. Disponibili: ${keys.join(', ')}`,
  isDefault: 'predefinito',
  modified: (defaultValue: string) => `modificato (predefinito ${defaultValue})`,
  settingRejected: (key, value, description) => `${key} non accetta ${value}: ${description}`,
};
