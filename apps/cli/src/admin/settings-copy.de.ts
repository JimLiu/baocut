import type { SettingsMessages } from './settings-copy.ts';
export const de: SettingsMessages = {
 help: `Verwendung:
  baocut settings                  Alle Einstellungen mit Schlüssel, aktuellem Wert, Standardstatus und Kurzbeschreibung anzeigen
  baocut settings get <key>        Aktuellen Wert einer Einstellung als JSON ausgeben
  baocut settings set <key> <value>
                                   Einstellung ändern. Der Wert wird als JSON gelesen (true, 20,
                                   {"cjk":18,"other":40}) oder bei ungültigem JSON als Zeichenfolge verwendet.
                                   Unbekannte Schlüssel und ungültige Werte werden abgelehnt; nichts wird gespeichert.
  baocut settings reset <key>      Standardwert wiederherstellen`,
 usage: 'Verwendung: baocut settings [get <key> | set <key> <value> | reset <key>]', setUsage: 'Verwendung: baocut settings set <key> <value> (Wert wird als JSON gelesen; anderes als Zeichenfolge. Werte mit Leerzeichen in Anführungszeichen setzen.)', unknownKey: (key, keys) => `Unbekannte Einstellung: ${key}. Verfügbar: ${keys.join(', ')}`, isDefault: 'Standard', modified: (defaultValue) => `geändert (Standard ${defaultValue})`, settingRejected: (key, value, description) => `${key} akzeptiert ${value} nicht: ${description}`,
};
