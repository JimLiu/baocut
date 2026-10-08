import { TEXT_EFFORTS } from '@baocut/protocol';
import type { TextMessages } from './text-copy.ts';

export const ru: TextMessages = {
  help: `Использование:
  baocut text <prompt> [options]   Вызвать текстовую модель один раз; запрос - читается из stdin. Полный текст идёт
                                   в stdout (с --out в файл, а stdout содержит задачу и
                                   результат как JSON); прогресс, предупреждения и версия модели идут в stderr
    --system <text>                Системное сообщение
    --json-schema <file>           Структурированный вывод: возврат и проверка по этой JSON Schema (корень —
                                   объект); при несовпадении задача завершается с MODEL_OUTPUT_INVALID
    --provider <id>                Поставщик каталога, например openai, google, anthropic, или custom:<name>;
                                   по умолчанию, если не указан (у этой возможности нет встроенного значения)
    --model <id>                   Модель; если не указана — модель поставщика по умолчанию
    --max-output-tokens <n>        Лимит вывода; если не указан — лимит модели. Обрезанный обычный
                                   текст выводится с предупреждением output-truncated
    --effort <${TEXT_EFFORTS.join('|')}>
                                   Уровень рассуждений; ближайший доступный, если нет выбранного;
                                   игнорируется без поддержки регулировки (объяснение в stderr)
    --temperature <0–2>            Только для принимающих моделей
    --seed <n>                     Только для принимающих моделей
    --out <file>                   Записать полный текст в файл`,
  stdinPromptHint: "Введите запрос и нажмите Ctrl-D для завершения:",
  missingPrompt: "Не указан запрос",
  jsonSchemaUnreadable: (file, reason) => `Не удалось прочитать JSON Schema ${file}: ${reason}`,
  jsonSchemaNotObject: "Файл --json-schema должен содержать объект JSON",
  singleModel: "text принимает только один --model",
  maxOutputTokensInvalid: "--max-output-tokens должен быть положительным целым числом",
  effortChoices: (efforts) => `--effort должен быть одним из ${efforts.join(", ")}`,
  temperatureRange: "--temperature должна быть от 0 до 2",
  seedInvalid: "--seed должен быть целым числом",
  noTextResult: "Задача завершена, но текст не возвращён",
  fetchOutputFailed: (artifactId, status) => `Не удалось получить результат ${artifactId}: HTTP ${status}`,
  written: (file) => `Записано: ${file}`,
  modelLine: (provider, model, usage) => `${provider} / ${model}${usage ? `, вход ${usage.input} / выход ${usage.output} токенов` : ""}`,
};
