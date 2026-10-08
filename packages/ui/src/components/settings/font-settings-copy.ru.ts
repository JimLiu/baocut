import { pluralForm } from '@baocut/protocol';
import { intlLocale } from '@baocut/protocol';
import type { FontSettingsMessages } from './font-settings-copy.ts';

export const ru: FontSettingsMessages = {
  lead: (total: number | null) => `Шрифты доступны из трёх источников: поставляемые с приложением, установленные на этом компьютере и каталог Google Fonts (число семейств: ${total === null ? 'около двух тысяч' : `около ${total.toLocaleString(intlLocale())}`}, открытые лицензии, скачивание по мере необходимости). При скачивании отправляются только имя семейства и насыщенность, аккаунт не нужен; шрифты сохраняются в данных приложения, вне папки видео.`,
  download: "Скачать",
  autoDownload: "Скачивать шрифты автоматически",
  autoDownloadDesc:
    "Скачивает из Google Fonts, когда для предпросмотра, открытия видео или экспорта нужен отсутствующий на компьютере шрифт. Если отключено, для отображения и экспорта сначала используются резервные шрифты; можно скачать вручную при выборе шрифта. В строгом офлайн-режиме скачивания нет.",
  cssEndpoint: "URL таблицы стилей",
  cssEndpointDesc: "Базовый URL зеркала. Оставьте пустым для https://fonts.googleapis.com.",
  fileEndpoint: "URL файлов шрифтов",
  fileEndpointDesc: "Файлы шрифтов скачиваются только из-под этого URL. Оставьте пустым для https://fonts.gstatic.com.",
  downloaded: "Скачанные шрифты",
  summary: (families: number, size: string) => `${pluralForm('ru', families, { one: `${families} семейство`, few: `${families} семейства`, many: `${families} семейств`, other: `${families} семейства` })} · ${size}`,
  none: "Пока нет",
  clearAll: "Очистить всё",
  empty: "Здесь перечислены шрифты, скачанные при выборе или автоматически при открытии видео и экспорте.",
  clearTitle: "Очистить скачанные шрифты?",
  clear: "Очистить",
  cancel: "Отмена",
  removed: (family: string, size: string) => `Удалён шрифт «${family}» · Освобождено ${size}`,
  inUseTip: "Используется незавершённым экспортом; удалите после завершения",
  removeTip: "Удалить скачанные файлы этого шрифта",
  removeLabel: (tip: string, family: string) => `${tip}: ${family}`,
  facts: (weights: string, size: string, licence: string, ago: string | null) => `Насыщенности ${weights} · ${size} · ${licence}${ago ? ` · Скачано ${ago}` : ""}`,
  inUse: "Используется экспортом",
};
