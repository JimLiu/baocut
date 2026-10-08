import type { SettingsMessages } from './settings-copy.ts';
export const nl: SettingsMessages = {
 help: `Gebruik:
  baocut settings                  Alle voorkeuren tonen: sleutel, huidige waarde, of dit de standaard is en een korte beschrijving
  baocut settings get <key>        De huidige waarde van een instelling afdrukken (JSON)
  baocut settings set <key> <value>
                                   Een instelling wijzigen; de waarde wordt als JSON gelezen (true, 20,
                                   {"cjk":18,"other":40}), of als tekst als dit niet lukt.
                                   Onbekende sleutels en ongeldige waarden worden geweigerd; er wordt niets opgeslagen
  baocut settings reset <key>      De standaardwaarde herstellen`,
 usage: 'Gebruik: baocut settings [get <key> | set <key> <value> | reset <key>]', setUsage: 'Gebruik: baocut settings set <key> <value> (de waarde wordt als JSON gelezen; alles wat geen JSON is wordt tekst; zet waarden met spaties tussen aanhalingstekens)', unknownKey: (key, keys) => `Onbekende instelling: ${key}. Beschikbaar: ${keys.join(', ')}`, isDefault: 'standaard', modified: (defaultValue) => `gewijzigd (standaard ${defaultValue})`, settingRejected: (key, value, description) => `${key} accepteert ${value} niet: ${description}`,
};
