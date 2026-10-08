import { pluralForm } from '../../i18n.ts';
import type { EngineHostMessages } from './engineHost.ts';

export const ru: EngineHostMessages = {
  runGenerationNotInteger: "runGeneration должен быть целым десятичным числом",
  secondsInvalid: (p) => `${p.field} должен быть конечным числом секунд не менее 0`,
  secondsOverflow: (p) => `${p.field} вне допустимого диапазона`,
  audioItemsKind: "audioItems применяется только к аудио- и видеопланам",
  skipAssetsKind: "skipAssets применяется только к видеопланам",
  outputKind: "output применяется только к видеопланам",
  outputSize: "Ширина и высота результата должны быть положительными целыми числами",
  tooManyRanges: (p) => pluralForm('ru', Number(p.max), { one: `Не более ${p.max} диапазона за раз`, few: `Не более ${p.max} диапазонов за раз`, many: `Не более ${p.max} диапазонов за раз`, other: `Не более ${p.max} диапазона за раз` }),
  textPlanNoDocument: "Текстовый план требует хотя бы один документ",
  textPlanTooManyDocuments: "Текстовый план принимает не более двух документов (основной и второй для двуязычного объединения)",
  planKindUnknown: (p) => `Неизвестный вид плана ${p.kind}`,
  unknownMethod: (p) => `Неизвестный метод: ${p.method}`,
  paramsInvalid: (p) => `Недопустимые параметры: ${p.error}`,
  fontFacesInvalid: (p) => `Укажите от 1 до ${p.max} начертаний: имя каждого семейства непустое, до 200 символов, насыщенность от 1 до 1000`,
  cacheDirRelative: "cacheDir должен быть абсолютным путём",
  fontPathRelative: "path должен быть абсолютным путём",
  fontInvalid: (p) => `Непригодный файл шрифта: ${p.error}`,
  videoPathRelative: "Путь к видео должен быть абсолютным",
  videoNotOpen: "Видео не открыто",
  taskStopped: "Выполнение остановлено, изменение не записано",
  afterNotInteger: "after должен быть целым десятичным числом",
  enginePanic: "Ошибка движка при обработке запроса, изменение не записано",
  pathRelative: "Пути должны быть абсолютными",
};
