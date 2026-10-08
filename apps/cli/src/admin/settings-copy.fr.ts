import type { SettingsMessages } from './settings-copy.ts';

export const fr: SettingsMessages = {

  help: `Utilisation :
  baocut settings                  Lister les préférences : clé, valeur actuelle, valeur par défaut ou non, description en une ligne
  baocut settings get <key>        Afficher la valeur actuelle d’un réglage (JSON)
  baocut settings set <key> <value>
                                   Modifier un réglage ; valeur analysée comme JSON (true, 20,
                                   {"cjk":18,"other":40}), sinon traitée comme chaîne.
                                   Clés inconnues et valeurs invalides refusées, rien n’est enregistré
  baocut settings reset <key>      Restaurer la valeur par défaut`,
  usage: "Utilisation : baocut settings [get <key> | set <key> <value> | reset <key>]",
  setUsage:
    "Utilisation : baocut settings set <key> <value> (valeur analysée comme JSON ; sinon traitée comme chaîne ; mettez les valeurs avec espaces entre guillemets)",
  unknownKey: (key: string, keys: readonly string[]) => `Réglage inconnu : ${key}. Disponibles : ${keys.join(", ")}`,
  isDefault: "par défaut",
  modified: (defaultValue: string) => `modifié (par défaut ${defaultValue})`,
  settingRejected: (key: string, value: string, description: string) => `${key} n’accepte pas ${value} : ${description}`,
};
