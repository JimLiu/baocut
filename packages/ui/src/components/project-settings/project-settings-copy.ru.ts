import { pluralForm } from '@baocut/protocol';
import type { ProjectSettingsMessages } from './project-settings-copy.ts';

export const ru: ProjectSettingsMessages = {
  menuItem: 'Настройки проекта…',
  title: 'Настройки проекта',
  close: 'Закрыть настройки проекта',
  done: 'Готово',
  loading: 'Проверка git',
  loadFailed: (message: string) => `Не удалось проверить git: ${message}`,

  gitHeading: 'git',
  gitLead:
    'BaoCut может коммитить снимки рабочей области ваших видео в git-репозиторий, в котором находится проект. Истории версий git не нужен, и вне репозитория она работает так же.',
  branch: (name: string) => `Ветка ${name}`,
  gitVersion: (version: string) => `git ${version}`,
  checkAgain: 'Проверить снова',
  sentences: (first: string, second: string | null) => (second ? `${first}. ${second}.` : `${first}.`),

  lightReady: 'В порядке',
  lightPaused: (label: string) => `Приостановлено · ${label}`,
  lightNotRepo: 'Не в git-репозитории',
  lightUnavailable: 'git не найден',
  lightError: 'Ошибка git',
  pauseLocked: 'Репозиторий занят',
  pauseMerge: 'Идёт слияние',
  pauseRebase: 'Идёт перебазирование',
  pauseCherryPick: 'Идёт cherry-pick',
  pauseRevert: 'Идёт revert',
  pauseBisect: 'Идёт bisect',
  pauseDetached: 'HEAD отсоединён',
  pauseLocalConfig: 'Локальные фильтры',
  pauseLocalConfigChanged: 'Локальные фильтры изменились',

  pausedHeading: (label: string) => `Коммиты приостановлены: ${label}`,
  pausedNote:
    'Пока коммиты приостановлены, автоматический коммит и «Закоммитить в git» ждут. Открытие, редактирование и история версий не затрагиваются.',
  errorHeading: 'Ошибка git',
  unavailableHeading: 'git не найден',

  lcEntry: 'Запись',
  lcValue: 'Команда или подключаемый файл',
  lcExplain:
    'После вашего разрешения BaoCut следует этим записям, когда запускает git (например, для шифрования git-crypt). Разрешение сохраняется только на этом компьютере, а не в проекте, и BaoCut снова приостановит коммиты, если записи или подключаемые файлы изменятся. Это не доверие к папке: открытие, редактирование и агенты не затрагиваются.',
  lcWeb:
    'Эти записи показываются и разрешаются только в настройках проекта в настольном приложении BaoCut (или через baocut projects git-allow). Пока коммиты приостановлены, открытие, редактирование и история версий не затрагиваются.',
  allow: 'Разрешить',
  allowedTitle: 'Локальные фильтры разрешены',
  allowedText: 'Разрешение сохранено на этом компьютере, а не в проекте. Теперь можно коммитить.',
  allowFailed: 'Не разрешено',

  commit: 'Закоммитить в git',
  committing: 'Создание коммита',
  commitDesc: (maxMiB: number) =>
    `Коммитит только файлы BaoCut: снимки рабочей области изменённых видео и материалы размером до ${maxMiB} MiB. Другие файлы проекта и изменения, которые вы уже проиндексировали (staged), остаются как есть. BaoCut не выполняет push.`,
  lastCommit: (commit: string, auto: boolean, ago: string) => `Последний коммит ${commit} · ${auto ? 'автоматически' : 'вручную'} · ${ago}`,
  lastFailed: (message: string) => `Последняя попытка не удалась: ${message}`,
  committedTitle: 'Закоммичено в git',
  committedText: (commit: string, files: number, videos: string[]) =>
    `Коммит ${commit}: ${pluralForm('ru', files, {
      one: `${files} файл`,
      few: `${files} файла`,
      many: `${files} файлов`,
      other: `${files} файла`,
    })}${videos.length ? `, ${videos.join(', ')}` : ''}.`,
  committedVideo: (name: string, from: number | null, to: number | null) =>
    from === null || to === null ? `«${name}»` : from === to ? `«${name}» версия ${to}` : `«${name}» версии ${from}–${to}`,
  unnamedVideo: 'видео без названия',
  nothingTitle: 'Нечего коммитить',
  nothingText: 'Файлы BaoCut такие же, как при последнем коммите.',
  commitFailed: 'Не закоммичено',

  autoCommit: 'Автоматический коммит',
  autoCommitDesc:
    'Коммитит один раз после 5 минут без изменений в проекте, когда вы закрываете последнее открытое видео проекта или выходите из BaoCut. Этот параметр общий для всех проектов на этом компьютере.',

  initTitle: 'Инициализировать git',
  initDesc: 'Создать git-репозиторий в папке проекта, чтобы коммитить в него снимки.',
  initWebNote: 'Создать репозиторий в папке на компьютере, где работает Runtime, можно только в настольном приложении BaoCut или через CLI (baocut projects git-init).',
  initRefused: (why: string) => `Здесь недоступно: ${why}`,
  initRefusedNote: 'Если репозиторий нужен, перенесите видео в отдельную папку проекта и инициализируйте git там.',
  refusalHome:
    'проект — это ваша домашняя папка. С репозиторием здесь для других инструментов все папки в домашней папке выглядели бы его частью.',
  refusalUserFolder:
    'проект — это стандартная папка пользователя (например, Рабочий стол, Документы, Загрузки, Фильмы, Музыка или Изображения). С репозиторием здесь для других инструментов все папки внутри выглядели бы его частью.',
  refusalVolumeRoot: 'проект — это корень диска. С репозиторием здесь весь диск выглядел бы его частью.',
  refusalInsideRepo: 'проект уже находится в git-репозитории.',
  initConfirmTitle: 'Инициализировать git в папке проекта?',
  initConfirmBody: (path: string) =>
    `Будет создан git-репозиторий в ${path}. Правила игнорирования BaoCut записываются в собственный .git/info/ репозитория, поэтому файлы проекта не меняются. Ничего не коммитится и не отправляется через push.`,
  cancel: 'Отмена',
  initDoneTitle: 'git инициализирован',
  initDoneText: 'Коммитов пока нет. Нажмите «Закоммитить в git», чтобы сделать первый коммит.',
  initFailed: 'Не инициализировано',

  recheckSame: 'Ничего не изменилось',
  recheckReadyTitle: 'Можно коммитить',
  recheckReadyText: 'Репозиторий больше не приостановлен.',

  outsideHeading: 'Материалы вне проекта',
  outsideLead:
    'Когда видео использует материалы вне папки проекта, его снимок рабочей области записывает путь к материалу (начиная с ~/ внутри домашней папки, иначе полный путь). После коммита или push другие получают только путь, а не файл. Чтобы передать и материалы, используйте переносимый пакет.',

  stripLabel: 'git проекта',
  projectSettings: 'Настройки проекта',
};
