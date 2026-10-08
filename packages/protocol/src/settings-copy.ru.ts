import { LOCALES } from './i18n.ts';
import type { SettingDescriptionMessages } from './settings-copy.ts';

export const ru: SettingDescriptionMessages = {
  'agent.defaultDriver': "Агент новых сессий; null использует встроенный по умолчанию (codex). Фиксируется при создании сессии",
  'agent.defaultModel': "Модель новых сессий; null — рекомендуемая модель (Sonnet для Claude Code, модель -sol для Codex), __agent-default__ — модель не передаётся, действует конфигурация CLI агента",
  'agent.defaultEffort': "Уровень рассуждений новых сессий; null использует значение агента по умолчанию",
  'agent.defaultAccessMode':
    "Для сессий без смены режима доступа: ask, autoAcceptEdits, auto, fullAccess или plan (старые controlled и authorized трактуются как ask и fullAccess)",
  'ui.language': `Язык интерфейса: system следует языку системы (английский при отсутствии), либо код языка (${LOCALES.join(", ")}). Текст Runtime для пользователя использует его тоже`,
  'captions.maxLineLength': "Целевая длина автоматического переноса (символы): cjk для китайского, японского и корейского текста, other для остального",
  'transcribe.afterComplete': "После расшифровки: open-video открывает видео, notify только уведомляет, nothing ничего не делает",
  'downloads.directory':
    "Место сохранения результатов инструментов без видео, медиа из ссылок и файлов downloads_save (абсолютный путь); null использует ~/Downloads на этом хосте независимо от проекта",
  'models.downloadEndpoint': "Источник локальных моделей (базовый URL зеркала, http(s)://); null использует публичный репозиторий. BAOCUT_MODELS_ENDPOINT имеет приоритет",
  'models.dir':
    "Папка локальных моделей (абсолютный путь); null использует models в папке данных. BAOCUT_MODELS_DIR имеет приоритет. Менять через models.setDir, не settings set",
  'tools.downloadEndpoint':
    "Источник управляемых внешних инструментов (yt-dlp) (базовый URL зеркала, http(s)://, файлы в <base>/<tool>/<version>/<file>); null использует официальный URL выпуска. BAOCUT_TOOLS_ENDPOINT имеет приоритет",
  'fonts.autoDownload': "Автоматически скачивать нужные для вёрстки шрифты, отсутствующие на компьютере и доступные в каталоге (предпросмотр и экспорт); при отключении использует резервный шрифт и уведомляет",
  'fonts.cssEndpoint': "Базовый URL CSS API шрифтов (зеркало, https://); null использует https://fonts.googleapis.com",
  'fonts.fileEndpoint': "Базовый URL файлов шрифтов (зеркало, https://; файлы только из-под него); null использует https://fonts.gstatic.com",
  'space.trashRetentionDays': "Дни хранения в корзине Space (1–3650): записи без ссылок и удалённые видео старше срока периодически удаляются навсегда",
  'cache.maxSizeMiB': 'Предельный размер кэша в папке данных, МиБ (256–1048576): при превышении удаляются самые старые файлы кэша (анализ медиа, копии для воспроизведения), пока размер не опустится до 90 %. Индекс поиска по всем видео не удаляется',
  'resources.capacity':
    "Расширенное: ресурсы машины для планирования { memoryMiB, gpuMemoryMiB, cpuThreads }; null у поля определяет автоматически; null у всего определяет всё (память и CPU из системы, GPU на Apple silicon по объединённой памяти)",
  'runtime.idleExitMinutes':
    "Минуты простоя Runtime, запущенного CLI, до самостоятельного выхода (1–1440): нет подключений, задач и внешних сервисов. Настольное приложение и ручной запуск не затрагиваются",
  'updates.autoCheck': "Проверять обновления приложения автоматически",
  'updates.autoDownload': "Скачивать новые версии в фоне (без автоматической установки)",
  'diagnostics.enabled': "Отправлять анонимную статистику использования и сводки производительности (без медиа, текста и путей)",
  'offline.strict': "Строго офлайн: ничего не отправлять онлайн-сервисам",
};
