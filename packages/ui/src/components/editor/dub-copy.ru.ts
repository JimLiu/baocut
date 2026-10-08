import { pluralForm } from '@baocut/protocol';
const sentences = (n: number) => pluralForm('ru', n, { one: `${n} предложение`, few: `${n} предложения`, many: `${n} предложений`, other: `${n} предложения` });
const glossaryCount = (n: number) => pluralForm('ru', n, { one: `${n} глоссарий`, few: `${n} глоссария`, many: `${n} глоссариев`, other: `${n} глоссария` });
const takeCount = (n: number) => pluralForm('ru', n, { one: `${n} дубль`, few: `${n} дубля`, many: `${n} дублей`, other: `${n} дубля` });
const these = (n: number) => n > 1 ? `эти ${sentences(n)}` : 'это предложение';
import type { DubOriginalAudio } from '@baocut/protocol';
import type { DubMessages, DubRegenMessages, TimelineDubMessages } from './dub-copy.ts';

export const ruDub: DubMessages = {

  title: "Перевод с озвучкой",
  back: "Назад",
  web: "Переводной дубляж требует приложения для компьютера",
  webBody: "BaoCut в браузере не предоставляет готовые процессы (pipelines.*), поэтому дубляж здесь не запустить. Откройте видео в приложении для компьютера.",
  summary: (language: string, count: number | null, translate: boolean) => `${translate ? `Сначала переводит на ${language}, затем синтезирует` : `Использует имеющийся перевод на ${language} и синтезирует`} речь ${count === null ? "по предложениям" : `для ${sentences(count)} по одному`}, выравнивает по времени исходного предложения и записывает на монтажную шкалу одной группой дубляжа`,
  language: "Язык дубляжа",
  languagePicker: "Язык дубляжа",
  languageLine: (translate: boolean, count: number | null) => `${translate ? "Перевода на этот язык пока нет · сначала перевод" : "Использует имеющийся перевод · без нового перевода"}${count === null ? "" : ` · ${sentences(count)}`}`,
  allTaken: "Нет языков для дубляжа.",
  staleNote: (n: number) => `Устаревший перевод: ${sentences(n)} (оригинал изменён или отмечен устаревшим). Эти предложения не озвучиваются и перечисляются в итогах. Переведите их заново в панели субтитров для полного дубляжа.`,
  source: "Оригинал",
  sourcePicker: "Озвучить расшифровку",
  sourceLine: (language: string, count: number | null) => (count === null ? language : `${language} · ${sentences(count)}`),
  voiceModel: "Модель голоса",
  voiceModelPicker: "Модель синтеза речи",
  voiceModelsLoading: "Загрузка речевых моделей…",
  manageVoiceModels: "Управление моделями речи…",
  ttsMissingTitle: "Модель речи пока недоступна",
  goTts: "Открыть Модели › Синтез речи",
  voice: "Голос по умолчанию",
  voicePicker: "Для говорящих без собственного голоса",
  voiceDefault: "По умолчанию модели",
  voiceCustom: "ID голоса",
  voiceCustomPlaceholder: "ID голоса из учётной записи поставщика",
  voiceHint: "Говорящие с назначенным ниже голосом используют его; остальные — выбранный здесь.",
  voiceCustomEmpty: "Сначала введите ID голоса или выберите другой голос",
  speakers: "Спикеры",
  speakersAside: (n: number) => `${n}`,
  speakersNone: "В расшифровке нет данных о говорящих, поэтому все предложения используют голос по умолчанию выше.",
  speakersNote: "Назначения сохраняются в видео (отменяемое изменение) и используются снова. Приоритет: назначенный → голос по умолчанию → голос модели.",
  speakerLine: (count: number) => sentences(count),
  speakerBinding: (name: string) => `Голос назначен: ${name}`,
  bindingNone: "Нет",
  bindingOther: (label: string) => `${label} (назначен в другом месте)`,
  bindingIgnored: (provider: string) => `Назначенный голос другого поставщика не используется с ${provider}`,
  bindingReadOnly: "Видео только для чтения; голоса говорящих нельзя менять.",
  bindingFailed: (message: string) => `Не удалось изменить голос говорящего: ${message}`,
  bindingLoading: "Загрузка голосов говорящих…",
  bindingReadFailed: (message: string) => `Не удалось прочитать назначенные в видео голоса: ${message}`,
  bindingSaved: (name: string) => `Назначен голос для ${name}`,
  bindingCleared: (name: string) => `Удалено ${name} — назначение голоса`,
  sourceVideo: "Назначено",
  sourceParams: "Голос по умолчанию",
  sourceDefault: "По умолчанию модели",

  effective: (label: string, source: string | null) => (source ? `Используется: ${label} (${source})` : `Используется: ${label}`),
  speakerWarning: (reason: string) => `Предложения этого говорящего не будут озвучены: ${reason}`,
  manageVoices: "Управление моими голосами…",
  mix: "Микширование",
  separate: "Отделить фоновое аудио",
  separateHint: "Дубляж заменяет только речь; музыка и звуки среды сохраняются",
  separateMissing: "На компьютере нет модели разделения; даже при включении оно пропускается, исходное аудио обрабатывается целиком.",
  installSeparate: "Установить модель разделения…",
  original: "Исходное аудио",
  originalPicker: "Обработка исходного аудио во время дубляжа",
  originalLabel: { duck: "Приглушить", mute: "Без звука", keep: "Не менять" },

  mixHint: (o: { separated: boolean; original: DubOriginalAudio; duckDb: number }) => o.original === 'keep'
      ? `Исходное аудио не меняется и играет под дубляжом${o.separated ? "; при сохранении разделения нет" : ""}.`
      : `${o.separated ? "Фон помещается на отдельную дорожку, в оригинале остаётся только речь, которая будет" : "Без разделения всё исходное аудио будет"} ${o.original === 'mute' ? "без звука" : `приглушено на −${o.duckDb} дБ`}. Вернуться к оригиналу можно в заголовке дорожки дубляжа в любое время.`,
  duckDb: "Приглушение (dB)",
  duckLabel: "Приглушить",
  duckUnit: "dB",
  translate: "Перевод",
  textModel: "Текстовая модель",
  textModelPicker: "Текстовая модель перевода",
  textModelsLoading: "Загрузка текстовых моделей…",
  manageTextModels: "Управлять текстовыми моделями…",
  textMissingTitle: "Пока нет доступной текстовой модели",
  goLlm: "Открыть Модели › Создание текста",
  noStructured: "Без структурированного вывода · перевод невозможен",
  style: "Подсказка стиля",
  stylePlaceholder: "Например: разговорно, кратко; сохранить исходные имена",
  styleHint: "По желанию; до 500 символов.",
  cta: (language: string) => `Озвучить на ${language}`,

  ctaHint: (language: string, stems: { separated: boolean; original: DubOriginalAudio }) => {
    const tracks = [`«Дубляж · ${language}»`];
    if (stems.separated && stems.original !== 'keep') tracks.push("«Фон»");
    if (stems.separated && stems.original === 'duck') tracks.push("«Вокал»");
    const list = tracks.length === 1 ? tracks[0] : `${tracks.slice(0, -1).join(", ")} и ${tracks[tracks.length - 1]}`;
    return `После завершения записывается на ${pluralForm('ru', tracks.length, { one: `дорожку`, few: `дорожки`, many: `дорожки`, other: `дорожки` })} ${list} монтажной шкалы; отмена одним нажатием. Сетевые модели оплачиваются за вызов.`;
  },
  noSpeechTitle: "Расшифровки для озвучивания пока нет",
  noSpeech: "Дубляж работает с предложениями расшифровки. Сначала расшифруйте материал через «Создать субтитры» в панели субтитров.",
  busy: "В этом видео уже выполняется дубляж; дождитесь завершения.",
  readOnly: "Видео только для чтения; добавить дубляж нельзя.",

  submitting: "Отправка дубляжа",
  queued: "В очереди",
  running: (language: string) => `Озвучивание · ${language}`,
  stepUnits: (step: 'translate' | 'synthesize', done: number, total: number | null) => `${step === 'translate' ? "Переведено" : "Озвучено"} ${total ? `${done} / ${sentences(total)}` : sentences(done)}`,
  sentences: (running: number, failed: number) => [running ? `${sentences(running)} озвучивается` : "", failed ? `${sentences(failed)} с ошибкой` : ""].filter(Boolean).join(" · "),
  cancel: "Отменить дубляж",
  cancelled: "Дубляж отменён",
  cancelFailed: (message: string) => `Не удалось отменить дубляж: ${message}`,
  liveNote: "После завершения Runtime записывает результат прямо на монтажную шкалу; отменить можно в любое время. Можно уйти с этой страницы.",
  foreign: "Этот дубляж запущен в другом месте. После завершения проверьте монтажную шкалу; отмена через редактор.",

  grantTitle: (recipient: string) => `Пока нет разрешения отправить расшифровку ${recipient}`,
  grantBody: "Дубляж отправляет поставщику перевод для синтеза (и оригинал, если перевода нет). Дайте разрешение только для этого видео; без него ничего не отправляется.",
  grantAction: "Дать разрешение и запустить",
  grantRetryAction: "Дать разрешение и повторить попытку",
  grantDialogTitle: "Разрешить передачу данных",
  grantDialogIntro: "После подтверждения BaoCut запишет разрешение и продолжит дубляж:",
  grantConfirm: "Разрешить и продолжить",
  grantCancel: "Не сейчас",
  granting: "Выдача разрешения…",
  grantFailed: (message: string) => `Не удалось выдать разрешение: ${message}`,
  grantStillRefused: "После выдачи разрешения всё ещё отказ",
  grantNext: "Если перевод и синтез используют разных поставщиков, каждому нужно своё разрешение.",
  commands: "Командная строка",

  notConfigured: "Дубляж пока недоступен",
  submitFailed: "Не удалось начать дубляж",
  failed: "Ошибка дубляжа",
  interrupted: "Дубляж прерван",
  retry: "Повторить попытку",
  retryFailed: (message: string) => `Не удалось повторить: ${message}`,
  retryCharges: "Повторная попытка начинается с остановленного шага. Если это «Перевод», весь шаг выполняется снова; готовые партии снова вызывают модель и могут оплачиваться повторно.",
  retryPartial: "Повторная попытка начинается с «Синтеза предложений»: готовые предложения используются снова, синтезируются только оставшиеся и ошибочные.",
  retryFree: "Повторная попытка начинается с остановленного шага; готовые предыдущие шаги используются без нового вызова модели.",
  retryFrozen: "Назначения голосов зафиксированы при запуске: исправление голоса (новый клон, заявление владельца) помогает повторной попытке, но смена назначений требует нового дубляжа.",
  failedUnits: (n: number) => `${sentences(n)} не удалось озвучить`,
  stoppedAt: (synthesized: number, remaining: number) => `Остановлено после озвучивания ${sentences(synthesized)}; ${remaining} осталось`,
  dismiss: "ОК",

  doneTitle: (language: string) => `Озвучено на ${language}`,
  doneToast: (language: string, placed: number) => `Озвучено на ${language} · ${sentences(placed)} помещено на монтажную шкалу`,
  placed: (placed: number, total: number) => `${placed} / ${total} предложений размещено на таймлайне`,
  fitHead: "Куда попало каждое предложение",
  speakersHead: "Голоса говорящих",
  speakerUnits: (n: number) => sentences(n),
  speakerNone: "Без говорящего",
  voiceFailedHead: "Предложения этих говорящих не озвучены",
  voiceFailedLine: (name: string, n: number, reason: string) => `${name} · ${sentences(n)} · ${reason}`,
  voiceFailedFix: "Дубляж завершён, повторная попытка недоступна: отмените группу → исправьте голос (новый клон, заявление владельца) или смените назначение → озвучьте снова.",
  synthesisLine: (calls: number, retries: number, failures: number, reused: number) => [
      pluralForm('ru', calls, { one: `${calls} вызов`, few: `${calls} вызова`, many: `${calls} вызовов`, other: `${calls} вызова` }),
      retries ? `${retries} отправлено повторно` : "",
      failures ? `${failures} с ошибкой` : "",
      reused ? `${sentences(reused)} использовано снова` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  translationCreated: "Новый перевод сохраняется в видео (отмена дубляжа его не удаляет)",
  translationUsed: "Использован имеющийся перевод",
  glossaryUsed: (n: number) => `Использовано: ${glossaryCount(n)}`,
  warnings: "Предупреждения",
  undo: "Отменить этот дубляж",
  undoing: "Отмена…",
  undone: "Дубляж отменён",
  undonePartial: "Отменены клипы, отключения звука и приглушения дубляжа. Пустая дорожка и документ плана остаются в видео (протокол не позволяет удалять дорожки и документы).",
  undoLabel: (language: string) => `Отменить дубляж (${language})`,
  undoFailed: "Не удалось отменить этот дубляж",
  undoNotOpen: "Сначала откройте это видео для отмены дубляжа.",
  close: "Закрыть",
  again: "Озвучить снова",
  providerFallback: "этот поставщик",
  unknownLanguage: "Неизвестный язык",
};

export const ruTimelineDub: TimelineDubMessages = {
  trackLabel: (language: string) => `Озвучка · ${language}`,

  stemTrackLabel: (stem: 'background' | 'vocals', language: string) => `${stem === 'vocals' ? "Вокал" : "Фон"} · ${language}`,

  rate: (rate: number, fast: boolean) => `${rate.toFixed(2)}×${fast ? " · слишком быстро" : ""}`,

  stretching: (rate: number, seconds: number) => `${rate.toFixed(2)}× · ${seconds.toFixed(2)} с`,
  tip: (parts: { text: string; speaker: string | null; rate: string; muted: boolean; manual: boolean; editable: boolean }) => [
      parts.text,
      parts.speaker,
      parts.rate,
      parts.muted ? "Без звука" : "",
      parts.manual ? "Скорость изменена вручную" : "",
      parts.editable ? "Тяните правый край для смены длительности · больше в контекстном меню" : "",
    ]
      .filter(Boolean)
      .join(" · "),
  menuLabel: (title: string) => `Меню дубляжа для «${title}»`,
  selection: (n: number) => `${sentences(n)} выделено`,
  count: (n: number) => (n > 1 ? `Эти ${n}` : "Это предложение"),
  listen: "Воспроизвести предложение",
  listenHint: (timecode: string, seconds: number, rate: string) => `${timecode} · ${seconds.toFixed(1)} с${rate ? ` · ${rate}` : ""}`,
  mute: (allMuted: boolean, n: number) => `${allMuted ? "Включить звук" : "Без звука"} ${these(n)}`,
  muteHint: (allMuted: boolean) => (allMuted ? "Вернуть дубляж этих предложений" : "Эти предложения замолкают · также при экспорте"),
  remove: (n: number) => `Удалить ${these(n)}`,
  removeHint: "Удаляет с дорожки дубляжа · можно отменить",
  removeGroup: "Удалить эту группу озвучки",
  removeGroupHint: (bed: boolean) => `${bed ? "Удаляет вместе с фоновым аудио" : "Удаляет весь дубляж этого языка"} · возвращает отключённый им оригинальный звук`,
  labelMute: "Отключить дубляж",
  labelUnmute: "Включить дубляж",
  labelRemove: "Удалить дубляж",
  labelRemoveGroup: (language: string) => `Удалить дубляж (${language})`,
  labelStretch: "Изменить скорость дубляжа",
  muted: (n: number) => `Отключено ${sentences(n)} дубляжа`,
  unmuted: (n: number) => `Включено ${sentences(n)} дубляжа`,
  removed: (n: number) => `Удалено: ${sentences(n)} дубляжа`,
  groupRemoved: (language: string) => `Удалено «Дубляж · ${language}» · пустая дорожка и документ плана дубляжа остаются в видео`,
  planUnread: "Не удалось прочитать план: отключённый оригинальный звук не восстановлен. Включите его в исходных клипах.",
};

export const ruDubRegen: DubRegenMessages = {

  headMenu: (label: string) => `«${label}» дорожка`,
  headLine: (c: { total: number; fast: number; muted: number; failed: number; queued: number }) => [
      sentences(c.total),
      c.failed ? `${c.failed} не озвучено` : "",
      c.fast ? `${c.fast} слишком быстро` : "",
      c.muted ? `${c.muted} отключено` : "",
      c.queued ? `${c.queued} пересоздаётся` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  listenDub: "Слушать дубляж",
  listenDubHint: (o: { bed: boolean; duck: boolean; others: boolean }) => `Дубляж этой группы${o.bed ? " + фон" : ""} · ${o.duck ? "оригинал приглушён" : "оригинал отключён"}${o.others ? " · другие языки отключены" : ""}`,
  listenDubKeep: "Эта группа сохранила оригинальное аудио, не записав его участки; используйте «Слушать оба»",
  listenOriginal: "Слушать оригинал",
  listenOriginalHint: (others: boolean) => `Возвращает оригинальное аудио видео · ${others ? "все группы дубляжа" : "эта группа дубляжа"} отключено`,
  listenBoth: "Слушать оба",
  listenBothHint: (bed: boolean) => `Для сравнения${bed ? " · фон этой группы отключён" : ""}`,
  sourceLabel: { dub: "Слушать дубляж", original: "Слушать оригинал", both: "Слушать оба" },
  sourceDone: { dub: (language: string) => `Прослушивание «Дубляж · ${language}»`, original: "Прослушивание оригинала · дубляж отключён", both: "Оригинал и дубляж воспроизводятся вместе" },
  regenSome: (n: number) => (n ? `Пересоздать ${sentences(n)}…` : "Пересоздать…"),
  regenSomeHint: (failed: number, fast: number) => failed || fast
      ? `${[failed ? `${failed} не озвучено` : "", fast ? `${fast} слишком быстро` : ""].filter(Boolean).join(" · ")} · сначала можно изменить перевод`
      : "Нет ошибочных или слишком быстрых предложений",
  redub: "Озвучить снова…",
  redubHint: "Открывает переводной дубляж: смените язык или голос и пересоздайте всю группу",
  readOnly: "Видео доступно только для чтения",

  regenBlocks: (n: number) => `Пересоздать ${these(n)}`,
  regenBlocksHint: "Снова синтезировать тот же перевод и голос · новый seed · старый дубль сохраняется",
  retext: "Изменить перевод и озвучить…",
  retextHint: "Сначала проверьте длительности и измените перевод, затем озвучьте только эти предложения",
  inQueue: "Некоторые предложения пересоздаются",

  queued: "Пересоздание…",
  queuedTip: (text: string) => `${text} · пересоздаётся`,
  version: (k: number, seed: number | null) => (seed === null ? `Дубль ${k}` : `Дубль ${k} · seed ${seed}`),

  submitted: (n: number) => `Начато пересоздание ${sentences(n)} дубляжа`,
  submitFailed: (message: string) => `Не удалось начать пересоздание: ${message}`,
  grantRefused: (recipient: string) => `Пересоздание отправляет перевод ${recipient}; разрешения пока нет. Дайте его в настройках или начните новый переводной дубляж`,
  busy: "Группа отправляется; подождите",
  done: (replaced: number, total: number) => replaced === total ? `Пересоздано ${sentences(replaced)} дубляжа` : `Пересоздано ${replaced}/${total} предложений дубляжа`,
  doneNone: "Ни одно предложение не получило новый дубль",
  notPlaced: (status: string, n: number) => status === 'overlong'
      ? `${sentences(n)} не поместилось; предыдущий дубль сохранён`
      : status === 'stale'
        ? `${sentences(n)} имели устаревший перевод и не озвучены`
        : status === 'voice-unavailable'
          ? `${sentences(n)} имели недоступный голос и не озвучены`
          : `${sentences(n)} отсутствуют на монтажной шкале`,
  failed: (message: string) => `Пересоздание не завершено: ${message}`,
  cancelled: "Пересоздание отменено",
  undo: "Отменить",
  undoMissing: "Не удалось найти изменение этого пересоздания; используйте отмену редактора",
  labelRetext: "Изменить перевод (озвучить снова)",

  fitTitle: (n: number) => `Изменить перевод и озвучить ${sentences(n)}`,
  fitIntro: "Вы редактируете произносимое предложение перевода (изменённые помечаются проверенными); субтитры не разделяются снова. Каждое предложение синтезируется с новым seed, старый дубль сохраняется.",
  fitDub: (seconds: number, rate: string) => `Озвучка ${seconds.toFixed(1)} с${rate ? ` · ${rate}` : ""}`,
  fitVoice: "Не озвучено: голос недоступен",
  fitOverlong: (seconds: number | null) => (seconds === null ? "Не размещено: слишком длинное" : `Не размещено: ${seconds.toFixed(1)} с лишних`),
  fitLoading: "Загрузка перевода…",
  fitUnreadable: (message: string) => `Не удалось прочитать перевод дубляжа (${message}); озвучивание только исходного перевода`,
  fitMissing: "Предложения нет в переводе; озвучивание по сценарию плана",
  fitText: (index: number) => `Перевод предложения ${index}`,
  fitCancel: "Отмена",
  fitSubmit: (n: number, changed: number) => (changed ? `Изменить ${changed} и озвучить ${sentences(n)}` : `Озвучить снова ${sentences(n)}`),
  fitBusy: "Отправка…",

  takesTitle: "Дубли",
  takesAside: (n: number) => takeCount(n),
  takeCurrent: "Текущий",
  takeUse: "Переключить на этот дубль",
  takeLine: (seed: number | null, seconds: number | null, tempo: number | null) => [
      seed !== null ? `seed ${seed}` : "",
      seconds !== null ? `${seconds.toFixed(1)} с` : "не размещено",
      tempo !== null && Math.abs(tempo - 1) >= 0.005 ? `${tempo.toFixed(2)}×` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  takeUnavailable: "Дубль отсутствует на монтажной шкале или его материал не найден",
  takesNote: "Каждое пересоздание записывает дубль; возврат к старому — отменяемое изменение без нового синтеза.",
  takeName: (k: number) => `Дубль ${k}`,
  labelSwitchTake: (k: number) => `Переключить на дубль ${k}`,
  switched: (k: number) => `Выбран дубль ${k}`,
  regenThis: "Пересоздать это предложение",
  unreadableFormat: "Нераспознанный формат",
  unreadableNoTranslation: "В плане нет перевода",
};
