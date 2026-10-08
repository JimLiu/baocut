import type { JobsYtDlpMessages } from './yt-dlp.ts';

export const ru: JobsYtDlpMessages = {
  toolNotFound: (p: { code: string }) => `Не удалось найти исполняемый yt-dlp (${p.code})`,
  remedyUnsupported: "Инструмент скачивания не поддерживает эту ссылку: используйте ссылку на страницу самого видео (не плейлист, трансляцию или страницу поиска)",
  remedyLoginRequired: "Войдите на сайте в браузере, затем выберите его в «Вход на сайт» и скачайте снова",
  remedyCookiesUnavailable: "Не удалось прочитать cookie браузера: убедитесь, что выполнен вход; если база используется, полностью закройте браузер (включая фоновые процессы); если доступ к Связке ключей запрещён, разрешите его; Safari нужен Полный доступ к диску; в Windows yt-dlp не читает cookie Chrome, Edge или Brave, защищённые app-bound encryption, используйте Firefox; либо попробуйте другой браузер",
  remedyToolUpdateRequired: "Не удалось разобрать сайт или инструмент устарел: обновите yt-dlp, определите снова и повторите попытку",
  remedyUnavailable: "Видео недоступно (удалено, ограничено регионом или нет формата для скачивания)",
  remedyNetworkError: "Нет соединения или скачивание прервано: проверьте сеть и повторите попытку (скачанные части будут использованы)",
  remedyDiskFull: "Недостаточно места для папки скачивания или Runtime Home: освободите место и повторите попытку",
  remedyDownloadFailed: "Инструмент скачивания сообщил об ошибке: смотрите details.stderr; возможно, нужно обновить yt-dlp (baocut external-tools detect)",
  exited: (p: { code: number | null }) => `yt-dlp завершился с кодом ${p.code}`,
  cookieLoginRequired: (p: { browser: string }) => `${p.browser}: сайт всё ещё требует вход`,
  cookieUnreadable: (p: { browser: string }) => `${p.browser}: не удалось прочитать cookie`,
  reasonSeparator: "; ",
  cookieAttemptsFailed: (p: { count: number; reasons: string }) => `Попробованы cookie из ${p.count} браузеров, ни один не сработал (${p.reasons})`,
  metadataUnreadable: "Не удалось прочитать метаданные инструмента скачивания",
  metadataNotObject: "Метаданные инструмента скачивания не являются объектом",
  playlist: "Ссылка ведёт на плейлист; импортируйте по одному видео",
  live: "Прямые трансляции нельзя импортировать",
};
