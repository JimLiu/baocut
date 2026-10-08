import { pluralForm } from '@baocut/protocol';
import type { FontsMessages } from './fonts-copy.ts';

export const ru: FontsMessages = {
  help: "Использование:\n  baocut fonts [downloaded]        Скачанные шрифты (Google Fonts, по мере необходимости):\n                                   семейство, насыщенности, размер, лицензия и общий размер\n  baocut fonts search [text] [--category <category>] [--script <script>] [--limit <n>]\n                                   Список выбора шрифтов: семейства приложения, компьютера и каталога\n                                   со статусом (встроенный, на компьютере, скачан, доступен для скачивания,\n                                   скачивается, ошибка). Категории: sans-serif, serif, display, handwriting,\n                                   monospace; письменности: chinese, japanese, korean, latin…\n  baocut fonts download <family> [--weights 400,700] [--italic]\n                                   Скачать семейство (обычное и полужирное по умолчанию); прогресс в stderr, Ctrl-C\n                                   отменяет. Отправляются только имя семейства и насыщенности; зеркала в настройках\n                                   fonts.cssEndpoint и fonts.fileEndpoint; в строгом офлайн-режиме отклоняется\n  baocut fonts remove <family>     Удалить скачанные шрифты семейства (нельзя, пока используется незавершённым экспортом)\n  baocut fonts clear               Очистить скачанные шрифты (используемые незавершённым экспортом сохраняются)",
  alreadyDownloaded: (family) => `«${family}» уже скачан`,
  downloadDone: "Скачивание завершено",
  remedy: (text) => `Как исправить: ${text}`,
  usage:
    "Использование: baocut fonts [downloaded] | search [text] [--category <category>] [--script <script>] [--limit <n>] | download <family> [--weights 400,700] [--italic] | remove <family> | clear",
  listSep: ", ",
  categoryChoices: (choices: readonly string[]) => `--category должен быть одним из ${choices.join(", ")}`,
  scriptChoices: (choices: readonly string[]) => `--script должен быть одним из ${choices.join(", ")}`,
  limitRange: "--limit должен быть целым числом от 1 до 500",
  italicNeedsWeights: "--italic применяется с --weights",
  weightsFormat: "--weights принимает насыщенности от 1 до 1000 через запятую",
  stateLabels: {
    'built-in': "Встроенный",
    installed: "На этом компьютере",
    downloaded: "Скачано",
    downloadable: "Доступно для скачивания",
    downloading: "Скачивание",
    failed: "Ошибка",
    unavailable: "Недоступно",
  },
  face: (weight: number, italic: boolean) => `${weight}${italic ? " курсив" : ""}`,
  noDownloads: "Скачанных шрифтов пока нет",
  downloadedTotal: (families: number, faces: number, size: string) => `${pluralForm('ru', families, { one: `${families} семейство`, few: `${families} семейства`, many: `${families} семейств`, other: `${families} семейства` })}, ${pluralForm('ru', faces, { one: `${faces} насыщенность`, few: `${faces} насыщенности`, many: `${faces} насыщенностей`, other: `${faces} насыщенности` })}, ${size} всего`,
  noMatches: "Нет подходящих шрифтов",
  failedWithReason: (state: string, message: string) => `${state} (${message})`,
  truncated: (total: number, shown: number) => `(${total} всего, показаны первые ${shown})`,
  removed: (count: number, freed: string) => `${pluralForm('ru', count, { one: `Удалена ${count} насыщенность`, few: `Удалены ${count} насыщенности`, many: `Удалено ${count} насыщенностей`, other: `Удалено ${count} насыщенности` })}, освобождено ${freed}`,
  nothingToRemove: "Нет шрифтов для удаления",
  kept: (count: number, faces: readonly string[]) => `Сохранено: ${count} (используется незавершённым экспортом): ${faces.join(", ")}`,
};
