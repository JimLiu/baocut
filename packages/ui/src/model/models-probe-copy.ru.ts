import { pluralForm } from '@baocut/protocol';
import type { ModelsProbeMessages } from './models-probe-copy.ts';

export const ru: ModelsProbeMessages = {
  speechText: "Здравствуйте, это тест синтеза речи BaoCut.",
  noResult: "Задача завершена, но результат не получен.",
  failed: "Задача завершилась ошибкой.",
  cancelled: "Задача отменена.",
  interrupted: "Runtime перезапущен, тест не завершён.",
  unknownOutcome: "Runtime перезапущен до получения ответа на этот вызов, поэтому результат неизвестен.",
  audioFacts: (seconds, khz, type) => `${seconds} с · ${khz} кГц · ${type}`,
  videoFacts: (width, height, seconds, type) => `${width} × ${height} · ${seconds} с · ${type}`,
  textFacts: (entries: number, seconds: string, type: string) => `${pluralForm('ru', entries, { one: `${entries} запись`, few: `${entries} записи`, many: `${entries} записей`, other: `${entries} записи` })} · ${seconds} с · ${type}`,
  packageFacts: (files: number, type: string) => `${pluralForm('ru', files, { one: `${files} файл`, few: `${files} файла`, many: `${files} файлов`, other: `${files} файла` })} · ${type}`,
  projectFacts: (clips: number, seconds: string, type: string) => `${pluralForm('ru', clips, { one: `${clips} клип`, few: `${clips} клипа`, many: `${clips} клипов`, other: `${clips} клипа` })} · ${seconds} с · ${type}`,
  chars: (count) => `${count} символов`,
  inputTokens: (count) => `${count} входных токенов`,
  outputTokens: (count) => `${count} выходных токенов`,
  hitLimit: "Достигнут лимит вывода",
  filtered: "Заблокировано фильтром содержимого поставщика",
  untested: "Не проверено",
  testing: "Проверка…",
  passed: "Тест пройден",
  passedIn: (seconds) => `Тест пройден · ${seconds} с`,
};
