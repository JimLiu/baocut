import { pluralForm } from '@baocut/protocol';
import type { ToolRunsMessages } from './tool-runs-copy.ts';


const spaced = (name: string) => (/^[\x20-\x7e]+$/.test(name) ? ` ${name} ` : name);

export const ru: ToolRunsMessages = {
  diarizeStep: "Определить спикеров",

  phaseDone: "Готово",
  phaseQueued: "В очереди",
  phaseCancelled: "Отменено",
  phaseUnfinished: "Не завершено",
  phasePreparing: "Подготовка",
  stepAt: (cur, total) => `Шаг ${cur} из ${total}`,
  cancelledAt: (step, at) => `Отменено на шаге «${step}» · ${at}`,
  stoppedAt: (step, at) => `Остановлено на шаге «${step}» · ${at}`,
  runningAt: (step, at) => `${step} · ${at}`,
  stepDone: "Готово",
  stepStopped: "Остановлено здесь",
  stepRunning: "В процессе",
  stepWaiting: "Ожидание",

  costEstimate: (amount, currency) => `О видео ${amount} ${currency}`,
  costSubscription: (recipient) => `Включено в подписку ${recipient}`,
  costFree: "Бесплатно",
  costMetered: (recipient) => `Оплата по тарифам ${recipient}; оценка здесь недоступна`,
  grantWhat: (kinds, purpose) => `${kinds.join(", ")} (${purpose})`,
  grantLoop: "Вы уже одобрили, но Runtime всё ещё отказывает. Проверьте разрешения в Настройки › Конфиденциальность или выберите другую модель.",

  noStructuredOutput: "Модель не поддерживает структурированный вывод, перевод невозможен",

  captionsCreated: (p) => `Создано: ${p.language ? `${p.language} слой субтитров` : "редактируемый слой субтитров"}${p.bilingual ? ", двуязычное отображение" : ""}${
      p.disabled ? " (материал уже показывает субтитры, новый слой изначально отключён)" : ""
    }`,
  captionsExistingTranslation: "У перевода уже есть слой субтитров, новый не создан",
  captionsExistingTranscript: "У расшифровки уже есть слой субтитров, новый не создан",
  captionsNotOnTimeline: "Ни один клип на таймлайне не использует материал, слой субтитров не создан",
  captionsEmpty: "Нет субтитров для отображения, слой не создан",
  originalAudio: { duck: "Исходное аудио приглушено", mute: "Исходное аудио отключено", keep: "Исходное аудио сохранено" },

  thisVideo: "это видео",
  newVideo: "Новое видео",
  fallbackVideo: "Видео",
  media: "медиа",
  savedFiles: (names) => `Расшифровка и субтитры сохранены: ${names.join(", ")}`,
  transcriptLanguage: (language, model) => `Язык расшифровки: ${language}${model ? ` (${model})` : ""}`,
  createdVideoLinked: (video, project) => `Создано видео «${video}»${project ? ` в «${project}»` : ""}; материал остаётся на месте и только связывается`,
  wroteTranscript: (video) => `Добавлена расшифровка в «${video}»`,
  speakersFound: (n) => pluralForm('ru', n, { one: `Найден ${n} говорящий; имена указаны в субтитрах и расшифровке`, few: `Найдено ${n} говорящих; имена указаны в субтитрах и расшифровке`, many: `Найдено ${n} говорящих; имена указаны в субтитрах и расшифровке`, other: `Найдено ${n} говорящего; имена указаны в субтитрах и расшифровке` }),
  wroteTranslation: (video, language, source) => `Добавлено: ${language} — перевод в видео «${video}»${source ? ` (из расшифровки ${source})` : ""}; оригинал не изменён`,
  unitCount: (n) => `${n} ${pluralForm('ru', n, { one: `предложение`, few: `предложения`, many: `предложений`, other: `предложения` })}`,
  subtitleFileWritten: (file, dir) => `Файл переведённых субтитров ${file} сохранён в ${dir}; число субтитров и таймкоды не изменены`,
  bilingualLayout: "Двуязычно: оригинал сверху, перевод снизу",
  markupStripped: (n) => pluralForm('ru', n, { one: `Удалена разметка из ${n} исходного субтитра`, few: `Удалена разметка из ${n} исходных субтитров`, many: `Удалена разметка из ${n} исходных субтитров`, other: `Удалена разметка из ${n} исходного субтитра` }),
  dubTranslated: (language) => `Переведено на ${language} сначала: добавлен новый перевод`,
  dubReusedTranslation: (language) => `Использован существующий ${language} — перевод`,
  dubWritten: (video, language, engine) => `Добавлена новая ${language} озвучка в видео «${video}»${engine ? ` (${engine})` : ""}; прежняя озвучка сохранена`,
  dubPlaced: (placed, total) => `${placed} из ${total} предложений размещено на таймлайне`,
  linkCreatedVideo: (video, project) => `Создано видео «${video}»${project ? ` в «${project}»` : ""}; скачанное медиа на таймлайне`,
  linkAddedTo: (file, video) => `Добавлено: ${file} в «${video}»; файл остаётся в папке скачивания`,
  linkDownloaded: (file, dir) => `Скачано: ${file}${dir ? ` до ${dir}` : ""}`,
  linkTranscribedFiles: "Расшифровка завершена; сохранены TXT и субтитры SRT",
  linkTranscribed: "Расшифровка завершена; добавлена расшифровка. Этот путь не создаёт слой субтитров; создайте в панели «Субтитры» редактора",
  replacedTranscript: (video) => `Расшифровка «${video}» заменена: одно изменение, которое можно отменить`,
  newVideoFrom: (video, project, original) =>
    `Создано видео «${video}»${project ? ` в «${project}»` : ''} со ссылкой на тот же материал; ${original ? `«${original}»` : 'исходное видео'} и его переводы не изменились`,
  carryTranslation: (language, kept, reviewed, stale) =>
    `Перевод (${language}) · сохранено: ${kept} (проверено: ${reviewed}) · устарело: ${stale}`,
  carryPins: (reanchored, orphaned) => `Pin субтитров · перепривязано: ${reanchored} · orphaned: ${orphaned}`,
  carryDub: (language, kept, stale) => `Озвучка (${language}) · сохранено: ${kept} · устарело: ${stale}`,
  nothingToCarry: 'В этом видео не было переводов, pin субтитров или озвучки для переноса',
  refreshHint: 'Устаревшие предложения переведите заново через «Обновить устаревшие переводы»',
};
