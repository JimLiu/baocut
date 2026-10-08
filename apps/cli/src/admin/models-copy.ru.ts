import { pluralForm } from '@baocut/protocol';
const forms = {"files": ["файл", "файла", "файлов", "файла"], "models": ["модель", "модели", "моделей", "модели"], "images": ["изображение", "изображения", "изображений", "изображения"], "calls": ["вызов", "вызова", "вызовов", "вызова"], "callsGen": ["вызова", "вызовов", "вызовов", "вызова"], "voices": ["голос", "голоса", "голосов", "голоса"], "sizes": ["размер", "размера", "размеров", "размера"]} as const;
const amount = (n: number, kind: keyof typeof forms) => { const f = forms[kind]; return pluralForm('ru', n, { one: `${n} ${f[0]}`, few: `${n} ${f[1]}`, many: `${n} ${f[2]}`, other: `${n} ${f[3]}` }); };
import { MODEL_SERVICE_CAPABILITIES, USAGE_PERIODS } from '@baocut/protocol';
import type { ModelsMessages } from './models-copy.ts';

export const ru: ModelsMessages = {
  help: `Использование:
  baocut models cancel <bundleId> [--discard]
                                   Остановить установку (загруженное сохраняется; повторите install для возобновления);
                                   --discard также удаляет загруженное
  baocut models repair <bundleId> [--yes]
                                   Проверить sha256 каждого файла и повторно загрузить только отсутствующие или повреждённые
                                   (подтверждение как при install)
  baocut models dir                Папка местных моделей: расположение, источник, занятое и свободное место, число распознанных моделей
  baocut models dir --set <path> [--move|--switch]
                                   Сменить папку моделей: --move переносит имеющиеся модели (фоновая задача с откатом
                                   при ошибке); --switch только меняет расположение (старые файлы остаются; доступны лишь модели
                                   в новой папке). Если текущая папка содержит модели, нужен один из этих вариантов.
                                   Недоступно, пока задача использует местную модель; только чтение, если папка задана
                                   переменной окружения BAOCUT_MODELS_DIR
  baocut models dir --reset [--move|--switch]
                                   Восстановить расположение по умолчанию (<BAOCUT_HOME>/models), правила как у --set
  baocut models configure <providerId> [options]
                                   Настроить сетевого поставщика: из каталога (openai, google, elevenlabs, anthropic, deepseek,
                                   qwen и другие; см. baocut models capabilities) либо свою совместимую с OpenAI точку custom:<name>.
                                   У агента agent:codex только включение/выключение (использует вход в Codex этого компьютера, без ключа)
    --enable | --disable           Включить (постоянные разрешения позволяют отправлять аудио материалов, текст или запросы) или выключить
    --key-stdin                    Прочитать API key из stdin (ключи в аргументах не принимаются): заменить ключ
                                   первой учётной записи либо создать запись, если их нет (для нескольких записей используйте
                                   baocut models accounts)
    --endpoint <url>               Base URL своей точки (обязателен при первом запуске); для поставщика каталога можно указать
                                   прокси или шлюз
    --model <id> ...               Модели расшифровки своей точки (можно повторять; первая — по умолчанию)
    --speech-model <id> ...        Модели синтеза речи своей точки (/audio/speech; можно повторять)
    --image-model <id> ...         Модели изображений своей точки (/images/generations; можно повторять)
    --text-model <id> ...          Текстовые модели своей точки (/chat/completions; можно повторять)
                                   Указание моделей любого типа заменяет все объявленные модели
    --verify                       Перед сохранением однократно проверить новый ключ и точку у поставщика
  baocut models accounts <providerId>
                                   Список учётных записей: порядок, имя, скрытый ключ, включение и статус (вызовы используют
                                   первую включённую запись с ключом; при ошибках следующая не используется)
  baocut models accounts add <providerId> [--label <name>] [--region <region>] [--endpoint <url>] [--verify]
                                   Добавить учётную запись; ключ из stdin; --region принимает регион каталога (например,
                                   global или cn); --verify сначала проверяет у поставщика и при ошибке не сохраняет.
                                   Добавление записи не включает поставщика
  baocut models accounts remove <providerId> <accountId|name>
                                   Удалить учётную запись и ключ (после удаления последней записи поставщик остаётся,
                                   но без пригодного ключа)
  baocut models accounts use <providerId> <accountId|name>
                                   Сделать приоритетной: переместить эту запись в начало
  baocut models usage [--period <${USAGE_PERIODS.join("|")}>] [--provider <id>]
                                   Вызовы, использование и расходы сетевых поставщиков и агентов (по умолчанию 30 дней):
                                   оценка по опубликованным ценам, данные поставщика и неизвестные расходы
                                   показаны отдельно, без пересчёта валют; по поставщику, функции, модели
                                   и учётной записи
  baocut models default <capability> <providerId|none> [modelId]
                                   Задать или сбросить поставщика и модель по умолчанию для функции (${MODEL_SERVICE_CAPABILITIES.join(", ")})
  baocut models remove <bundleId|providerId>
                                   Удалить местный комплект моделей (общие компоненты других комплектов сохраняются;
                                   отказ, если задача использует его); либо удалить сетевого поставщика: свою точку
                                   custom:<name> целиком; поставщик каталога выключается, его записи и ключи удаляются
  baocut models refresh <providerId>
                                   Получить и кешировать модели и голоса сетевого поставщика: встроенные модели,
                                   отсутствующие в списке, отмечаются недоступными; если получение не удалось,
                                   остаётся встроенный список
  baocut models parameters generateText [--effort <level|default>] [--concurrency <n|default>]
                                   Посмотреть или задать уровень рассуждения и лимит одновременных запросов
                                   каждого поставщика (по умолчанию 4); default восстанавливает заводские значения`,
  byteProgressUnknown: (done) => `${done} получено (общий размер неизвестен)`,
  byteProgress: (done, total, percent) => `${done} / ${total} (${percent}%)`,
  bundleStates: {
    'not-installed': "Не установлен",
    downloading: "Скачивание",
    installed: "Установлено",
    loading: "Загрузка",
    ready: "Готово",
    busy: "Занят",
    unloading: "Выгрузка",
    error: "Недоступно",
  },
  installStates: {
    queued: "В очереди",
    downloading: "Скачивание",
    verifying: "Проверка и публикация",
    paused: "Приостановлено",
  },
  bundleState: (label, state, reason) => `${label} (${state}${reason ? ` / ${reason}` : ""})`,
  componentInstalled: "установлено",
  componentMissing: "отсутствует",
  sharedWith: (bundles) => `  общие с ${bundles.join(", ")}`,
  installTask: (jobId) => `  задача ${jobId}`,
  resumeHint: (bundleId) => `; возобновить: baocut models install ${bundleId}`,
  installLine: (state, progress, task, hint) => `  Установка: ${state}  ${progress}${task}${hint}`,
  checkPassed: "пройдено",
  checkFailed: (code) => `ошибка${code ? ` (${code})` : ""}`,
  checkLine: (result, at, detail) => `  Проверка: ${result}  ${at}${detail ? `  ${detail}` : ""}`,
  remedyAppFileMissing: "Решение: переустановите BaoCut; восстановление модели не поможет",
  remedyRepair: (bundleId) => `Решение: baocut models repair ${bundleId} повторно загрузит только повреждённые файлы; затем проверьте ещё раз`,
  remedyMaybeRepair: (bundleId) => `Решение: сначала попробуйте baocut models repair ${bundleId} (повторно загрузит только повреждённые файлы), затем проверьте ещё раз`,
  remedyOutOfMemory: "Решение: закройте приложения с большим расходом памяти или выберите меньшую модель, затем проверьте ещё раз",
  remedy: (text) => `Как исправить: ${text}`,
  upToDate: (repair, bundleId) => repair ? `${bundleId} файлов целы; восстанавливать нечего` : `${bundleId} уже установлено; загружать нечего`,
  planHeader: (repair, bundleId, source) => `${repair ? "Восстановить" : "Установить"} ${bundleId} из ${source}`,
  planKeep: (component, repo) => `  ${component}  ${repo}  установлено, сохранено`,
  planDownload: (component, repo, files, size) => `  ${component}  ${repo}  загрузить ${amount(files, "files")}, ${size}`,
  sizeUnknown: "размер неизвестен",
  toDownloadEstimate: (estimate) => `К загрузке: размер неизвестен, примерно ${estimate}`,
  toDownload: (size) => `К загрузке: ${size}`,
  resumed: (size) => `Возобновление: ${size} уже во временном каталоге и не будет загружено снова`,
  freeSpace: (size, short) => `Свободное место: ${size}${short ? " (недостаточно)" : ""}`,
  sizeAbout: (size) => `около ${size}`,
  installPrompt: (repair, size) => `${repair ? "Восстановить" : "Установить"} и загрузить ${size}? [y/N] `,
  noSpace: (need, have) => `Место на диске: требуется ${need}, только ${have}`,
  removed: (files) => `Удалено: ${files.join(", ")}`,
  nothingRemoved: "Файлы не удалены",
  keptInUse: (repo, users) => `Сохранено: ${repo}: всё ещё используется ${users.join(", ")}`,
  keptOtherVersion: (repo) => `Сохранено: ${repo}: в папке другая версия, не входящая в этот комплект моделей`,
  dirSources: {
    default: "расположение по умолчанию",
    setting: "папка, выбранная в настройках",
    env: "переменная окружения BAOCUT_MODELS_DIR (только чтение: измените переменную и перезапустите BaoCut)",
  },
  dirSource: (label) => `  Источник: ${label}`,
  dirMissing: "  Папка отсутствует (возможно, внешний диск не подключён)",
  dirNotWritable: "  BaoCut не может записывать в эту папку",
  dirUsage: (used, free, models) => `  Занято ${used}${free ? ` · свободно на диске ${free}` : ""} · найдено ${amount(models, "models")}`,
  dirDefault: (path) => `  Расположение по умолчанию: ${path}`,
  dirMoving: (to, jobId) => `  Перемещение${to ? ` до ${to}` : ""} (задача ${jobId})`,
  dirEnvLocked: "Папка моделей задана BAOCUT_MODELS_DIR: измените переменную и перезапустите BaoCut",
  dirProblemMissing: "Папка отсутствует: возможно, внешний диск не подключён; подключите его и повторите попытку",
  dirProblemNotWritable: "BaoCut не может записывать в эту папку: выберите доступную для записи или измените права",
  dirProblemNested: "Новая папка и текущая папка моделей вложены одна в другую: выберите папку, которая не содержит текущую и не находится в ней",
  dirProblemSame: "Это уже текущая папка моделей",
  dirFound: (count, size) => `Найдено ${amount(count, "models")} (${size}), готово к использованию`,
  dirEmpty: "В этой папке пока нет моделей; новые загрузки попадут сюда",
  dirFree: (size) => `${size} свободно на диске`,
  moveSameVolume: "Тот же диск: перемещение только переименовывает файлы и не требует дополнительного места",
  moveSize: (size, fits) => `перемещение ${size}${fits ? "" : ", не помещается"}`,
  dirCurrentHas: (size, move) => `В текущей папке ${size} моделей: ${move}`,
  moveOrSwitch: "Используйте только один из --move и --switch",
  accountStates: {
    unknown: "Не проверено",
    ok: "ОК",
    'invalid-key': "Неверный ключ",
    'rate-limited': "Ограничение частоты",
    'quota-exhausted': "Квота исчерпана",
  },
  rateLimitedUntil: (label, until) => `${label} (до ${until})`,
  noAccounts: "Учётных записей пока нет: baocut models accounts add <providerId> читает ключ из стандартного ввода",
  accountEnabled: "включено",
  accountDisabled: "выключено",
  accountKeyUnreadable: "не удаётся прочитать ключ",
  accountRegion: (region) => `регион ${region}`,
  accountEndpoint: (endpoint) => `конечная точка ${endpoint}`,
  accountLastUsed: (at) => `последнее использование: ${at}`,
  accountCurrent: "используется",
  accountChoice: (accountId, label) => `${accountId} (${label})`,
  noAccountChoices: "нет учётных записей",
  listSep: ", ",
  accountAmbiguous: (count, ref, choices) => `${count} учётных записей с именем «${ref}»; укажите accountId: ${choices}`,
  accountNotFound: (ref, choices) => `Нет такой учётной записи: ${ref} (варианты: ${choices})`,
  usagePeriods: { today: "Сегодня", '7d': "Последние 7 дней", '30d': "Последние 30 дней", all: "За всё время" },
  unitTokens: (input, output) => `ввод ${input} / выход ${output} токенов`,
  unitCached: (cached) => `${cached} кешировано`,
  unitAudio: (minutes) => `${minutes} мин аудио`,
  unitChars: (chars) => `${chars} символов`,
  unitImages: (images) => amount(images, "images"),
  clauseSep: ", ",
  costKinds: {
    reported: "по данным поставщика",
    estimated: "оценка по опубликованным ценам",
    mixed: "по данным и оценке",
    unknown: "стоимость неизвестна",
  },
  rowCalls: (calls, failed) => `${amount(calls, "calls")}${failed > 0 ? ` (неудачных: ${failed})` : ""}`,
  costApprox: (money, kind) => `≈ ${money} (${kind})`,
  usageHeader: (scope, period, from, to) => `Использование (${scope ? `${scope}, ` : ""}${period}: ${from} до ${to})`,
  noCalls: "  Вызовов пока нет",
  totalCalls: (calls, failed) => `  ${amount(calls, "calls")}${failed > 0 ? ` (неудачных: ${failed})` : ""}`,
  usageUnits: (units) => `  Использование: ${units}`,
  spentEstimated: (money) => `  Расходы ≈ ${money} (оценка по опубликованным ценам)`,
  spentReported: (money) => `  Расходы ${money} (по данным поставщика)`,
  unknownCostCalls: (calls) => `  Неизвестна стоимость ещё ${amount(calls, "callsGen")}`,
  noBilledCalls: "  Платных вызовов нет",
  byProvider: "По поставщикам",
  byCapability: "По функциям",
  byModel: "По моделям",
  byAccount: "По учётным записям",
  usageRepair: "Использование: baocut models repair <bundleId> [--yes]",
  usageCancel: "Использование: baocut models cancel <bundleId> [--discard]",
  usageConfigure: "Использование: baocut models configure <providerId> [--enable|--disable] [--key-stdin] [--endpoint <url>] …",
  usageDefault: "Использование: baocut models default <capability> <providerId|none> [modelId]",
  usageRemove: "Использование: baocut models remove <bundleId|providerId>",
  usageRefresh: "Использование: baocut models refresh <providerId>",
  usageParameters: "Использование: baocut models parameters generateText [--effort <level|default>] [--concurrency <n|default>]",
  usageAccounts:
    "Использование: baocut models accounts <providerId> | add <providerId> [--label <name>] [--region <region>] [--verify] | remove <providerId> <account> | use <providerId> <account>",
  usageDir: "Использование: baocut models dir [--set <path> [--move|--switch] | --reset [--move|--switch]]",
  cancelledDiscarded: "Остановлено, загруженная часть удалена",
  cancelledKept: "Остановлено (загруженная часть сохранена; повторите install для возобновления)",
  unknownCapability: (capability, choices) => `Неизвестная возможность: ${capability} (один из ${choices.join(", ")})`,
  clearDefaultNoModel: "Не указывайте модель при сбросе значения по умолчанию",
  defaultSet: (label, provider, model) => `${label} по умолчанию: ${provider} / ${model}`,
  defaultCleared: (label) => `${label} настройка по умолчанию сброшена`,
  customProviderDeleted: (id) => `Удалено: ${id} (настройки по умолчанию, указывающие на него, сохранены и отмечены недоступными)`,
  providerRemoved: (id) => `Удалено ${id}: выключен, все учётные записи и ключи удалены (настройки по умолчанию сохранены и отмечены недоступными)`,
  providerRefreshFailed: (id, error) => `Не удалось обновить ${id}: ${error ?? 'unknown reason'}; используется встроенный список моделей`,
  providerRefreshed: (id, models, voices, at) => `Обновлено ${id}: ${amount(models, "models")}${voices !== undefined ? `, ${amount(voices, "voices")}` : ""} (${at})`,
  periodChoices: (periods) => `--period должен быть одним из ${periods.join(", ")}`,
  enableDisableConflict: "Используйте только один из --enable и --disable",
  saved: (description) => `Сохранено: ${description}`,
  verifiedAndSaved: "Проверено и сохранено",
  savedPlain: "Сохранено",
  providerNotEnabled: (id) => `${id} ещё не включён: baocut models configure ${id} --enable`,
  accountRemoved: (name) => `Удалена учётная запись ${name}`,
  accountPreferred: (name) => `Приоритетная запись: ${name}`,
  providerHasNoAccounts: (id) => `${id} не имеет аккаунтов`,
  noSuchProvider: (id) => `Нет такого поставщика: ${id}`,
  alreadyRepairing: (jobId) => `Уже восстанавливается (задача ${jobId}); показан прогресс`,
  nothingToRepair: "Нет файлов для восстановления",
  notTtyConfirmDownload: "Запуск не в терминале: добавьте --yes после подтверждения загрузки пользователем",
  notDownloaded: "Не скачано",
  nothingToDownload: "Нечего загружать",
  repairDone: "Восстановление завершено",
  repairPartialKept: (bundleId) => `Загруженная часть сохранена: выполните baocut models repair ${bundleId} для продолжения`,
  setResetConflict: (usage) => `Используйте только один из --set и --reset. ${usage}`,
  dirHasModels: "В текущей папке есть модели: добавьте --move для переноса или --switch только для смены расположения (старые файлы сохраняются)",
  dirChanged: (dir, oldFilesKept) => `Папка моделей изменена на ${dir}${oldFilesKept ? " (файлы в прежней папке сохранены)" : ""}`,
  modelsMoved: (dir) => `Модели перемещены в ${dir}`,
  dirRolledBack: "Откат выполнен: исходная папка моделей не изменилась",
  pasteKeyHint: "Вставьте API key, нажмите Return, затем Ctrl-D для завершения:",
  noKeyOnStdin: "Нет API key в стандартном вводе",
  keyHasWhitespace: "API key не должен содержать пробелы или переводы строк: передайте только ключ в стандартном вводе",
  positiveInteger: (option) => `${option} должно быть положительным целым числом`,
  effortChoices: (efforts) => `--effort должен быть одним из ${efforts.join(", ")}`,
  capabilityLabels: {
    transcribe: "Расшифровка",
    synthesizeSpeech: "Синтез речи",
    generateImage: "Генерация изображений",
    generateText: "Генерация текста",
    separateAudio: "Разделение голоса",
  },
  unavailableLabels: {
    'not-configured': "не включено",
    'missing-credential': "нет API key",
    'not-installed': "не установлено",
    'signed-out': "выход выполнен",
    outdated: "версия слишком старая",
    'not-paired': "не сопряжено",
    'not-connected': "не удаётся подключиться",
    unsupported: "не поддерживается",
    resource: "выключено после повторных ошибок",
  },
  unavailable: "недоступно",
  capabilityState: (label, available, reason) => `${label} ${available ? "доступно" : `недоступно (${reason})`}`,
  capabilitySep: ", ",
  configEnabled: "включено",
  configDisabled: "выключено",
  keyState: (set) => `ключ ${set ? "задан" : "не задан"}`,
  configEndpoint: (url) => `конечная точка ${url}`,
  modelListRefreshed: (at) => `список моделей обновлён ${at}`,
  lastRefreshFailed: (at) => `последнее обновление не удалось (${at}); используется встроенный список`,
  textParameters: (effort, concurrency) => `Уровень рассуждения по умолчанию: ${effort ?? "the model's own"} · одновременных запросов на поставщика ${concurrency}`,
  markDefault: "по умолчанию",
  markDeclared: "задано пользователем",
  wordTimestampsNative: "временные метки слов",
  wordTimestampsEstimated: "время слов оценено по длине",
  maxInputMegabytes: (mb) => `≤ ${mb} МБ на вызов`,
  maxDurationMinutes: (minutes) => `≤ ${minutes} мин на вызов`,
  voiceCount: (count, defaultVoice) => `${amount(count, "voices")} (по умолчанию ${defaultVoice ?? "нет"})`,
  noPresetVoices: "нет готовых голосов; голос нужно указать",
  acceptsCustomVoices: "принимает пользовательские голоса",
  maxInputChars: (count) => `≤ ${count} символов на вызов`,
  acceptsInstructions: "принимает указания стиля",
  sizeCount: (count, defaultSize) => `${amount(count, "sizes")}${defaultSize ? ` (по умолчанию ${defaultSize})` : ""}`,
  aspectRatios: (ratios) => `соотношения сторон ${ratios}`,
  maxImageCount: (count) => `≤ ${count} изображений на вызов`,
  sizeAndSeedFixed: "размер и seed нельзя задать",
  contextTokens: (count) => `контекст ${count} токенов`,
  maxOutputTokens: (count) => `вывод ≤ ${count} токенов`,
  efforts: (efforts, defaultEffort) => `уровень рассуждения ${efforts}${defaultEffort ? ` (по умолчанию ${defaultEffort})` : ""}`,
  structuredOutput: "структурированный вывод",
  subscription: "включено в подписку, квота неизвестна",
  modelName: (id, label) => `${id} (${label})`,
};
