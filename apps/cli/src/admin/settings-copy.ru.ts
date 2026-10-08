import type { SettingsMessages } from './settings-copy.ts';

export const ru: SettingsMessages = {
  help: "Использование:\n  baocut settings                  Список всех параметров: ключ, текущее значение, признак значения по умолчанию и краткое описание\n  baocut settings get <key>        Вывести текущее значение настройки (JSON)\n  baocut settings set <key> <value>\n                                   Изменить настройку; значение разбирается как JSON (true, 20,\n                                   {\"cjk\":18,\"other\":40}), а если разбор невозможен — как строка.\n                                   Неизвестные ключи и недопустимые значения отклоняются, ничего не сохраняется\n  baocut settings reset <key>      Вернуть значение по умолчанию",
  usage: "Использование: baocut settings [get <key> | set <key> <value> | reset <key>]",
  setUsage: "Использование: baocut settings set <key> <value> (значение разбирается как JSON; всё, что не JSON, считается строкой; значения с пробелами заключайте в кавычки)",
  unknownKey: (key: string, keys: readonly string[]) => `Неизвестная настройка: ${key}. Доступны: ${keys.join(", ")}`,
  isDefault: "по умолчанию",
  modified: (defaultValue: string) => `изменено (по умолчанию ${defaultValue})`,
  settingRejected: (key, value, description) => `${key} не принимает ${value}: ${description}`,
};
