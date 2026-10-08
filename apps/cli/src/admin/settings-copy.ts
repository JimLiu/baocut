import { defineMessages } from '@baocut/protocol';
import { zhHans } from './settings-copy.zh-Hans.ts';
import { zhHant } from './settings-copy.zh-Hant.ts';
import { ja } from './settings-copy.ja.ts';
import { ko } from './settings-copy.ko.ts';
import { es } from './settings-copy.es.ts';
import { fr } from './settings-copy.fr.ts';
import { de } from './settings-copy.de.ts';
import { nl } from './settings-copy.nl.ts';
import { ptBR } from './settings-copy.pt-BR.ts';
import { it } from './settings-copy.it.ts';
import { ru } from './settings-copy.ru.ts';
import { pl } from './settings-copy.pl.ts';
import { tr } from './settings-copy.tr.ts';
import { vi } from './settings-copy.vi.ts';

/** `baocut settings` 的文案（英文是键与类型的来源，译文在 `settings-copy.<语言>.ts`）。 */
const en = {
  /** `baocut settings --help` 与 `baocut help settings` 的正文。 */
  help: `Usage:
  baocut settings                  List all preferences: key, current value, whether it's the default, and a one-line description
  baocut settings get <key>        Print a setting's current value (JSON)
  baocut settings set <key> <value>
                                   Change a setting; the value is parsed as JSON (true, 20,
                                   {"cjk":18,"other":40}), or taken as a string if it can't be parsed.
                                   Unknown keys and invalid values are rejected, and nothing is saved
  baocut settings reset <key>      Restore the default value`,
  usage: 'Usage: baocut settings [get <key> | set <key> <value> | reset <key>]',
  setUsage:
    "Usage: baocut settings set <key> <value> (the value is parsed as JSON; anything that isn't JSON is taken as a string; quote values that contain spaces)",
  unknownKey: (key: string, keys: readonly string[]) => `Unknown setting: ${key}. Available: ${keys.join(', ')}`,
  isDefault: 'default',
  modified: (defaultValue: string) => `modified (default ${defaultValue})`,
  settingRejected: (key: string, value: string, description: string) => `${key} doesn't accept ${value}: ${description}`,
};

export type SettingsMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
