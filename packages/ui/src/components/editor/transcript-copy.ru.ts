const words = (n: number) => pluralForm('ru', n, { one: `${n} слово`, few: `${n} слова`, many: `${n} слов`, other: `${n} слова` });
import { pluralForm } from '@baocut/protocol';
import type { TranscriptMessages, TranscriptToolsMessages } from './transcript-copy.ts';


function secondsLabel(seconds: number): string { return (seconds < 10 ? (Math.round(seconds * 10) / 10).toLocaleString('ru', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : Math.round(seconds).toLocaleString('ru')) + ' с'; }

export const ruSeconds = secondsLabel;

export const ruTranscript: TranscriptMessages = {
  title: "Расшифровка",
  modes: "Режим редактирования расшифровки",
  modeEdit: "Редактировать текст",
  modeCut: "Вырезать медиа",

  hintEdit: "Меняет только текст расшифровки, видео и аудио сохраняются. Двойной щелчок по слову для правки; ⌫ удаляет только текст.",
  hintCut: "Выделите текст и нажмите ⌫, чтобы вырезать из видео, аудио и субтитров вместе. Вырезанные слова зачёркнуты, их можно восстановить.",

  emptyTitle: "Расшифровки ещё нет",
  emptyNoMedia: "Сначала добавьте видео или аудио. После расшифровки речь появится здесь.",
  emptyNotPlaced: "Видео или аудио ещё не на таймлайне. Разместите и расшифруйте, текст появится здесь.",
  emptyNotTranscribed: "Материалы таймлайна ещё не расшифрованы. Расшифруйте в панели «Субтитры», текст появится здесь.",
  gotoSubtitle: "Расшифровать в субтитрах",
  addMedia: "Добавить медиа",
  loading: "Загрузка расшифровки…",
  noWords: "В расшифровке нет слов для отображения.",
  notSpeech: "Формат расшифровки не распознан.",


  stats: (count: number, cut: number) => (cut ? `${words(count)} · ${cut} вырезано` : words(count)),
  jump: "Перейти сюда",
  cutWordTitle: "Вырезано с таймлайна",
  partialWordTitle: "Вырезание внутри слова; на таймлайне осталась часть",

  selected: (count: number, seconds: number | null) => seconds === null ? `${words(count)} выделено` : `${words(count)} выделено · ${secondsLabel(seconds)}`,
  cut: "Вырезать",
  restore: "Восстановить",
  editWord: "Изменить слово",
  deleteText: "Удалить текст",
  clear: "Снять выделение · Esc",
  aiFind: "Найти вырезы",
  aiFindHint: "Или сначала поручите ИИ найти слова-паразиты и паузы",

  cutDone: (seconds: number, ranges: number) => ranges > 1 ? `Вырезание ${secondsLabel(seconds)} · ${ranges} диапазонов` : `Вырезание ${secondsLabel(seconds)}`,
  cutNothing: "Выделенных слов больше нет на таймлайне, вырезать нечего.",
  cutTooShort: "Выделение короче кадра, вырезать нельзя.",
  restoreDone: (seconds: number) => `Восстановлено: ${secondsLabel(seconds)}`,
  restoreNotRelaid: "У части вырезаний нет стыка на таймлайне. Удалены из списка, но содержимое не восстановлено.",
  restoreRefused: {
    untracked: "Диапазон убран не вырезанием (например, обрезан краем клипа), восстановить вырезание нельзя. Перетащите край клипа на таймлайне для восстановления.",
    partial: "Вырезана только часть диапазона, диапазон изменить нельзя. Сначала нажмите полосу вырезания для восстановления.",
  },
  textSaved: "Текст обновлён · видео и аудио не изменены",
  textDeleted: (count: number) => `Удалён текст: ${words(count)} · видео и аудио не изменены`,

  stale: (count: number) => pluralForm('ru', count, { one: `${count} дорожка субтитров создана из старой расшифровки и не обновлена.`, few: `${count} дорожки субтитров созданы из старой расшифровки и не обновлены.`, many: `${count} дорожек субтитров созданы из старой расшифровки и не обновлены.`, other: `${count} дорожки субтитров создано из старой расшифровки и не обновлено.` }),
  gotoCaptions: "Открыть субтитры",
  undo: "Отменить",

  seamLabel: (seconds: number) => `Вырезание ${secondsLabel(seconds)} · нажмите для восстановления`,
  cutLabel: "Вырезать в расшифровке",
  restoreLabel: "Восстановить вырезанное",
  liveCopy: "Копировать уже расшифрованное",
  liveCopied: "Уже расшифрованное скопировано · расшифровка продолжается",
  liveSpeaker: "Распознаётся",
  liveWaiting: "Распознанный текст появляется здесь по мере поступления. Некоторые сервисы возвращают его целиком в конце.",
  liveNote: "Распознанный текст появляется по абзацам. Редактировать его можно после завершения расшифровки.",
  liveJump: "К последнему",
  liveSaving: "Сохранение расшифровки",
};

export const ruTranscriptTools: TranscriptToolsMessages = {


  findTip: "Найти и заменить · ⌘F",
  findLabel: "Найти и заменить",
  findPlaceholder: "Найти в расшифровке",

  lockTranslation: "Здесь можно искать переводы, но не менять — панель «Расшифровка» меняет только оригинал",
  lockLoading: "Новая версия расшифровки загружается; замените после завершения",
  replaceLabel: "Заменить текст расшифровки",
  replaceDone: (count: number) => `Заменено: ${count} ${pluralForm('ru', count, { one: "совпадение", few: "совпадения", many: "совпадений", other: "совпадения" })} · видео и аудио не изменены`,
  replaceNothing: "Нет совпадений для замены",

  copyMenu: "Скопировать расшифровку",
  copyAllHead: (lang: string) => `Скопировать всё · ${lang}`,
  copyText: "Копировать текст",
  copySettings: "Настройки копирования",
  copyWithSettings: "Копировать с настройками",
  copyTextOnly: "Копировать только текст",
  textOnly: "Только текст",
  keepCut: "С вырезанным",
  copyConfirm: "Копировать",
  copyTranslationOnly: "Показан только перевод, поэтому текст берётся из панели: без метаданных, вырезанное не попадает.",
  copyScopeHead: (scope: string) => `Скопировать ${scope}`,
  copied: (scope: string, receipt: string) => `Скопировано: ${scope} · ${receipt}`,
  copyFailed: "Не удалось скопировать · браузер запретил буфер обмена",
  copyEmpty: "Нечего копировать",
  scopeAll: "всё",
  scopePara: "этот абзац",
  scopeChapter: (title: string) => `«${title}»`,
  scopeSelection: "выделенный текст",
  copySelection: "Копировать",
  copySelectionTip: "Скопировать выделенный текст · ⌘C",

  langLabel: "Язык расшифровки",
  langSource: "Оригинал",
  langTranslation: "Перевод",
  langBoth: (source: string, translation: string) => `${source} + ${translation}`,
  showBoth: "Показать оригинал рядом",
  showBothNeedsTranslation: "Сначала выберите перевод",
  showBothHint: "Рядом",
  noTranslation: "Переводов ещё нет",
  noTranslationHint: "Переведите из панели «Субтитры» через «+ Перевести на…»",
  translationNote: "Перевод следует воспроизведению только по абзацам — время слов есть только в оригинале, подсветка слов была бы выдуманной.",
  translationOnly: "При просмотре только перевода нельзя менять или вырезать; переключитесь на оригинал или совместный вид.",
  noParagraphTranslation: "У абзаца нет перевода",

  paraMenu: "Этот абзац…",
  moveUp: "Переместить в предыдущую главу",
  moveDown: "Переместить в следующую главу",
  play: "Воспроизвести абзац",
  moveHead: "Переместить в главу",
  moveTo: (title: string) => `Переместить в «${title}»`,
  moveWith: (count: number) => (count > 1 ? `Перемещает вместе с соседями на этой стороне, ${count} абзацев всего` : "Перемещает только этот абзац"),

  noPrev: "Перед абзацем нет главы",
  noNext: "После абзаца нет главы",
  moveBlocked: "Перемещение опустошит главу или пересечёт начало соседней",
  moveLabel: "Переместить абзац в соседнюю главу",
  moved: (title: string, count: number) => (count > 1 ? `Перемещено: ${count} абзацев в «${title}»` : `Перемещено в «${title}»`),
  cutPara: "Вырезать абзац",
  cutParaHint: "Вырезает видео, аудио и субтитры вместе; можно восстановить",

  chapterMenu: "Эта глава…",
  renameChapter: "Переименовать…",
  cutChapter: "Вырезать главу",
  cutChapterHint: "Вырезает видео, аудио и субтитры вместе; следующие главы сдвигаются вперёд",
  cutChapterLabel: "Вырезать главу",
  cutChapterRefused: {
    empty: "У главы нет длительности",
    whole: "Глава занимает всё видео; вырезание ничего не оставит",
    'no-tracks': "Ни одна дорожка не использует расшифрованные материалы, вырезать нечего",
  },
  cutChapterDone: (title: string, seconds: number) => `Вырезать «${title}» · ${secondsLabel(seconds)}`,
  removeMarker: "Удалить метку главы",
  removeMarkerHint: "Удаляет только метку, содержимое сохраняется",
  find: "Найти",
  badRegex: "Недопустимое регулярное выражение",
  noResults: "Нет результатов",
  previous: "Предыдущий",
  next: "Дальше",
  closeFind: "Закрыть поиск",
  replaceWith: "Заменить на",
  matchCase: "Учитывать регистр",
  wholeWordShort: "Слово",
  wholeWord: "Совпадение целого слова",
  regex: "Регулярное выражение · текст замены вставляется буквально",
  replace: "Заменить",
  replaceAll: "Заменить всё",
  regexError: (error: string) => `Ошибка регулярного выражения: ${error}`,
};
