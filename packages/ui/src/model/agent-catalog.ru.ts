import { pluralForm } from '@baocut/protocol';
import type { AgentCatalogMessages } from './agent-catalog.ts';

export const ru: AgentCatalogMessages = {
  idEmpty: "Введите id, например my-agent",
  idPattern: "id должен начинаться со строчной буквы и содержать только строчные буквы, цифры и дефисы",
  idTooLong: "id может содержать не более 63 символов",
  idBuiltin: (id: string, who: string | null) => `«${id}» — id встроенного агента BaoCut${who ? ` (${who})` : ""}. Выберите другой id`,
  idTaken: (id: string, who: string | null) => `Агент${who ? ` (${who})` : ""} уже использует id «${id}». Выберите другой id`,
  nameEmpty: "Введите имя для списка",
  nameTooLong: (max: number) => pluralForm('ru', max, { one: `Имя может содержать не более ${max} символа`, few: `Имя может содержать не более ${max} символов`, many: `Имя может содержать не более ${max} символов`, other: `Имя может содержать не более ${max} символа` }),
  commandEmpty: "Введите команду запуска, например my-agent --acp",
  commandShell: "Введите одну команду: BaoCut запускает её напрямую, без оболочки, поэтому конвейеры, перенаправления и && не работают",
  tooManyArgs: (max: number) => `Слишком много аргументов: максимум ${max}`,
  envLine: (line: number) => `Строка ${line} должна иметь вид KEY=VALUE, где KEY начинается с буквы или подчёркивания`,
};
