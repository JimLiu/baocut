import { pluralForm } from '@baocut/protocol';
import type { ModelsAddedMessages } from './models-added-copy.ts';

const languages = (n: number) => pluralForm('ru', n, { one: `${n} язык`, few: `${n} языка`, many: `${n} языков`, other: `${n} языка` });

export const ru: ModelsAddedMessages = {
  entryLabel: 'Добавить другие модели',
  entryDesc: (n: number, group: 'tts' | 'music' | 'sep') => {
    if (group === 'sep') return `Помимо встроенной, в audio.cpp есть ещё ${pluralForm('ru', n, { one: `${n} модель`, few: `${n} модели`, many: `${n} моделей`, other: `${n} модели` })} для отделения голоса от фона. Можно также добавить собственный файл GGUF.`;
    const music = group === 'music';
    const kind = music ? 'генерации музыки' : 'синтеза речи';
    const models = pluralForm('ru', n, { one: `${n} модель`, few: `${n} модели`, many: `${n} моделей`, other: `${n} модели` });
    return `Помимо встроенных, audio.cpp поддерживает ещё ${models} ${kind}, а также другие варианты точности встроенных. Можно также добавить собственный файл GGUF.`;
  },
  entryButton: 'Добавить модель…',

  title: 'Добавить модели audio.cpp',
  lede: (engine: string) =>
    `Можно добавить любую модель, которую поддерживает встроенный в BaoCut движок audio.cpp (${engine}). Добавленные модели скачиваются, прослушиваются и удаляются так же, как встроенные. BaoCut не проверял каждую из них, поэтому попробуйте модель и проверьте её, чтобы понять, насколько хорошо она работает.`,
  loading: 'Загрузка списка моделей audio.cpp…',
  loadFailed: (text: string) => `Не удалось загрузить список моделей: ${text}`,
  groupsLabel: 'Группы моделей',
  groups: { tts: 'Речь', music: 'Музыка', sep: 'Разделение', idle: 'Пока не используются', custom: 'Свой файл' },
  searchLabel: 'Поиск моделей audio.cpp',
  searchPlaceholder: 'Поиск по названию, языку или возможности',
  countFound: (n: number) => `Найдено: ${n}`,
  countIdle: (n: number) => `${n} · пока нельзя добавить`,
  countFamilies: (n: number) =>
    pluralForm('ru', n, { one: `${n} семейство моделей`, few: `${n} семейства моделей`, many: `${n} семейств моделей`, other: `${n} семейства моделей` }),
  listLabel: 'Модели audio.cpp',
  empty: (q: string) => `В этой группе ничего не найдено по запросу «${q}». Если нужного файла нет в списке, его можно добавить самостоятельно.`,
  emptyAction: 'Добавить свой файл…',
  done: 'Готово',
  cancel: 'Отмена',

  status: { experimental: 'Экспериментальная', community: 'От сообщества', testing: 'Тестируется' },
  chipNonCommercial: 'Только некоммерческое',
  chipCheckLicense: 'Коммерческое использование не проверено',
  options: (n: number) => pluralForm('ru', n, { one: `${n} вариант`, few: `${n} варианта`, many: `${n} вариантов`, other: `${n} варианта` }),
  withParts: (names: readonly string[]) => `Скачивается вместе с ${names.join(', ')}`,
  noPackages: 'В источнике пока нет GGUF для скачивания',
  versionLabel: (name: string) => `Версия ${name}`,
  builtin: 'Встроенная',
  added: 'Добавлена',
  add: 'Добавить',

  traits: {
    clone: 'Клонирование голоса',
    design: 'Голос по описанию',
    voices: (n: number) =>
      pluralForm('ru', n, { one: `${n} встроенный голос`, few: `${n} встроенных голоса`, many: `${n} встроенных голосов`, other: `${n} встроенного голоса` }),
    style: 'Стиль',
    emotion: 'Управление эмоциями',
    lyrics: 'Текст песни',
    instrumental: 'Инструментал',
  },
  languages: {
    auto: 'Определяет язык',
    count: languages,
    atLeast: (n: number) => `${n}+ языков`,
    multilingual: 'Многоязычная',
    any: 'Любой язык',
    modelDependent: 'Зависит от модели',
    more: (shown: readonly string[], total: number) => `${shown.join(' / ')} и другие (${languages(total)})`,
  },
  tasks: {
    asr: 'Распознавание речи',
    vad: 'Обнаружение голоса',
    wake_word: 'Слово активации',
    classify: 'Классификация звуков',
    align: 'Выравнивание текста',
    diar: 'Метки говорящих',
    vc: 'Преобразование голоса',
    s2s: 'Голосовой диалог',
    midi: 'В MIDI',
    sfx: 'Звуковые эффекты',
    sep: 'Разделение источников',
    svc: 'Преобразование певческого голоса',
    edit: 'Редактирование аудио',
    turn: 'Определение конца реплики',
    tts: 'Речь',
    clone: 'Клонирование голоса',
    design: 'Создание голоса',
    music: 'Музыка',
  },
  idle: {
    recognize: 'Для транскрипции по-прежнему используются собственные модели распознавания BaoCut: распознавание в audio.cpp медленнее и не различает говорящих',
    'separate-slow': 'Разделяет чище всех, но намного медленнее, а лицензия неясна; пока используйте Mel-Band RoFormer',
    'separate-stems': 'Делит звук на 6 дорожек; для дубляжа нужны только голос и фон, поэтому используйте HTDemucs',
    'separate-speakers': 'Разделяет голоса нескольких людей, а не голос и фон; BaoCut пока это не использует',
    other: (tasks: string) => (tasks ? `${tasks} · BaoCut пока это не использует` : 'BaoCut пока это не использует'),
    'music-request': 'Эта музыкальная модель принимает другие запросы, чем YuE2, и BaoCut их пока не поддерживает',
    'engine-route': 'Движок предоставляет эту модель только для задач, которые BaoCut пока не использует',
  },
  sepTraits: {
    htdemucs: 'Голос и фон · одна модель, меньше встроенной HTDemucs-FT',
    mel_band_roformer: 'Голос и фон · разделяет чище встроенной модели',
  },

  sourceLabel: 'Где находится файл?',
  sourceRepo: 'На Hugging Face',
  sourceLocal: 'На этом компьютере',
  urlLabel: 'Адрес файла',
  urlPlaceholder: 'https://huggingface.co/user/repo/blob/main/model.gguf',
  urlParsed: (repo: string, revision: string, path: string) =>
    `Репозиторий ${repo} · ревизия ${revision} · файл ${path}. Размер и контрольная сумма считываются при добавлении и используются для проверки загрузки.`,
  urlHelp: 'Вставьте веб-адрес файла или запишите его как user/repo/file.gguf. Модели из нескольких файлов добавляются из списка.',
  urlErrors: {
    empty: 'Введите адрес файла',
    'not-hf': 'Этот адрес не распознан. Вставьте веб-адрес файла на Hugging Face или запишите его как user/repo/file.gguf',
    'not-gguf': 'Можно добавлять только файлы .gguf. Модели из нескольких файлов добавляйте из списка',
  },
  fileLabel: 'Файл',
  filePlaceholder: 'Не выбран',
  fileHelp: 'Используется на месте: BaoCut читает этот файл напрямую, не копируя и не изменяя его, поэтому он готов сразу после добавления. Если переместите или удалите файл, добавьте его снова.',
  fileRequired: 'Сначала выберите файл .gguf',
  chooseFile: 'Выбрать файл…',
  pickTitle: 'Выберите файл модели GGUF',
  pickFilter: 'Модель GGUF',
  familyLabel: 'Запускать как',
  familyHelp: (about: string) => `${about}. audio.cpp читает файл в соответствии с выбранным семейством; при неверном выборе проверка покажет ошибку.`,
  familyHelpNone: 'audio.cpp определяет, как читать файл, по его семейству.',
  familyRequired: 'Выберите семейство',
  nameLabel: 'Название (необязательно)',
  namePlaceholder: 'Используется имя файла',
  addLocal: 'Добавить',
  addRepo: 'Добавить и скачать…',

  addedToast: (name: string) => `Добавлено: «${name}»`,
  addedInPlaceToast: (name: string) => `Добавлено: «${name}» · файл используется на месте, без копирования`,
  addFailed: (text: string) => `Не удалось добавить: ${text}`,

  chipAdded: 'Добавлена',
  inPlace: (path: string) => `Использует ${path} на месте · не в папке моделей`,
  sourceKey: 'Источник',
  sourceCatalog: (family: string) => `Список моделей audio.cpp · запускается как ${family}`,
  sourceRepoFile: (address: string, family: string) => `${address} · запускается как ${family}`,
  sourceLocalFile: (family: string) => `Файл на этом компьютере · запускается как ${family}`,
  unlist: 'Убрать из списка',
  unlistTitle: (name: string) => `Убрать «${name}» из списка?`,
  unlistInPlaceBody: (path: string) => `Файл останется в ${path}. BaoCut перестанет его использовать и не удалит его. Чтобы снова использовать файл, добавьте его ещё раз.`,
  unlistConfirm: 'Убрать',
  unlistedToast: (name: string) => `«${name}» убрано из списка`,
  unlistedInPlaceToast: (name: string) => `«${name}» убрано из списка · файл не тронут`,
  unlistFailed: (text: string) => `Не удалось убрать из списка: ${text}`,
  removeAddedNote: 'Эту модель добавили вы, поэтому при удалении она также убирается из списка. Чтобы снова её использовать, добавьте её ещё раз.',
  licenseCheckUse: 'Неясно, разрешено ли коммерческое использование. Прочитайте лицензию, прежде чем использовать модель в содержимом, которое планируете использовать в коммерческих целях.',
};
