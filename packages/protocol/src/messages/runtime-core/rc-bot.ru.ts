import { pluralForm } from '../../i18n.ts';
import type { RcBotMessages } from './rc-bot.ts';

const minutes = (n: number) => `${n} ${pluralForm('ru', n, { one: 'минуту', few: 'минуты', many: 'минут', other: 'минуты' })}`;

export const ru: RcBotMessages = {
  // ---- 频道 ----
  mainChannelName: 'Всё',
  channelNotFound: (p: { id: string }) => `Канал не найден: ${p.id}`,
  mainChannelLocked: 'Канал по умолчанию нельзя архивировать или удалить.',
  channelArchived: 'Этот канал в архиве. Восстановите его, чтобы продолжить здесь работу.',
  channelDeleteCountsChanged: 'Число задач или запланированных задач в этом канале изменилось. Проверьте ещё раз перед удалением.',
  memoryVersionConflict: 'Память изменилась с тех пор, как вы её открыли. Посмотрите последнюю версию и попробуйте снова.',
  memoryTooLarge: (p: { max: number }) => `Память может занимать не больше ${p.max} КБ. Наведите в ней порядок, прежде чем добавлять ещё.`,
  memorySensitive: 'Не храните в памяти ключи, пароли, номера документов и банковских карт.',
  accessAboveChannelMax: 'Режим доступа задачи не может быть выше лимита канала.',

  // ---- 任务 ----
  workItemNotFound: (p: { id: string }) => `Задача не найдена: ${p.id}`,
  workItemCursorInvalid: 'Позиция в списке задач недействительна. Загрузите список заново.',
  transitionDenied: (p: { from: string; event: string }) => `Задача не может выполнить «${p.event}», пока находится в состоянии ${p.from}.`,
  textHasLinkOrNumber: 'В тексте задачи не должно быть ссылок, адресов электронной почты и длинных номеров. Добавьте их в ресурсы.',
  titleByUser: 'Это название написали вы, поэтому агент не может его изменить.',
  userTasksNoThread: 'Ваши собственные задачи не запускают поток.',
  stoppedByYou: 'Вы остановили это.',
  continueOrStop: 'Продолжить или остановить?',
  optionContinue: 'Продолжить',
  optionStop: 'Остановить',
  stalledNoProgress: (p: { minutes: number }) => `Нет продвижения уже ${minutes(p.minutes)}.`,
  stalledJobHung: (p: { job: string }) => `${p.job} молчит намного дольше, чем ожидалось.`,
  stalledBudget: 'Эта задача израсходовала 80 % своего бюджета.',
  interruptedOnExit: 'Прервано при последнем закрытии BaoCut.',
  threadLost: 'Поток этой задачи пропал.',
  agentUnavailable: (p: { agent: string }) => `${p.agent} сейчас недоступен, поэтому задача не запустилась. Проверьте его в настройках и продолжите.`,
  needsYouToRun: (p: { agent: string }) => `Для этого шага нужно ваше присутствие: ${p.agent} не умеет запрашивать подтверждение по шагам. Продолжить сейчас?`,
  approvalWaiting: (p: { summary: string }) => `Ждёт вашего подтверждения: ${p.summary}`,
  youAnswered: (p: { text: string }) => `Ваш ответ: ${p.text}`,
  youConfirmedDone: 'Вы подтвердили, что всё готово.',
  youReopened: 'Вы снова открыли эту задачу.',
  previousQuestion: (p: { text: string }) => `Предыдущий вопрос: ${p.text}`,
  implicitReopenNote: (p: { what: string }) => `После того как задача была решена, поток изменил ${p.what}.`,
  movedFrom: (p: { channel: string }) => `Перенесено из ${p.channel}.`,
  queued: (p: { position: number }) => `Ждёт свободного места (№ ${p.position}).`,
  revertUserEdits: (p: { video: string; version: number }) =>
    `Вы редактировали ${p.video} в версии ${p.version}, поэтому отменить только изменения агента нельзя.`,
  revertMixedVersion: (p: { video: string; version: number }) =>
    `В версии ${p.version} видео ${p.video} ваши правки смешаны с правками агента, поэтому отменить только изменения агента нельзя.`,

  // ---- 频道对话里 Runtime 写的 ----
  fallbackRelay: (p: { title: string; headline: string }) => `${p.title}: ${p.headline}`,
  reminder: (p: { title: string }) => `Напоминание: ${p.title}`,
  reminderOverdue: (p: { title: string; date: string }) => `Срок «${p.title}» был ${p.date}. Задача всё ещё открыта.`,
  reminderStale: (p: { title: string; days: number }) =>
    `«${p.title}» ждёт вас уже ${p.days} ${pluralForm('ru', p.days, { one: 'день', few: 'дня', many: 'дней', other: 'дня' })}.`,
  welcome:
    'Расскажите, что сделать с вашими видео, и я всё возьму на себя, а когда понадобится ваше участие, дам знать.',
  welcomeWithProjects: (p: { projects: number; videos: number }) =>
    `Я вижу ${pluralForm('ru', p.projects, { one: `${p.projects} проект`, few: `${p.projects} проекта`, many: `${p.projects} проектов`, other: `${p.projects} проекта` })} и ${p.videos} видео. Расскажите, что нужно сделать, и я всё возьму на себя.`,
  starterSummarize: 'Кратко пересказать видео',
  starterSummarizeText: 'Кратко перескажи моё последнее видео',
  starterCaptions: 'Добавить субтитры',
  starterCaptionsText: 'Добавь субтитры к моему последнему видео',
  starterHighlights: 'Найти лучшие моменты',
  starterHighlightsText: 'Найди лучшие моменты в моём последнем видео',
  channelIntro: (p: { name: string; purpose: string }) => `Этот канал для: ${p.purpose}. Скажите, что здесь сделать, и вся работа останется в этом канале.`,
  channelIntroNoPurpose: (p: { name: string }) => `Это канал «${p.name}». Расскажите, для чего он и с чего начать.`,
  starterChannelPlan: 'Предложить первые задачи',
  starterChannelPlanText: (p: { subject: string }) => `Предложи первые задачи для: ${p.subject}`,
  starterChannelLatest: 'Взять моё последнее видео',
  starterChannelLatestText: (p: { subject: string }) => `Возьми моё последнее видео для: ${p.subject}`,
  starterChannelGoal: 'Рассказать подробнее',
  starterChannelGoalText: 'Подробнее о том, для чего этот канал: ',
  markDone: 'Отметить готовой',
  handoffDriver: (p: { agent: string }) => `Продолжаем с ${p.agent}.`,
  editedMessage: 'Вы изменили это сообщение.',
  reactionYes: 'Да',
  reactionNo: 'Нет',
  approvalNeedsYou: 'Вас ждёт запрос на подтверждение.',
  makeNoGenerator: 'Текстовая модель не настроена, поэтому предложения недоступны.',
  scheduleNotReady: 'Запланированные задачи сейчас недоступны.',
  proposalChannelExists: 'Канал с таким названием уже есть.',
  dependencyWaiting: (p: { title: string }) => `Ждёт «${p.title}».`,
  lateStart: (p: { minutes: number }) => `Запущено с опозданием на ${minutes(p.minutes)}.`,

  // ---- 通知 ----
  notifyNeedsReview: (p: { title: string }) => `«${p.title}» готово к проверке`,
  notifyNeedsInput: (p: { title: string }) => `«${p.title}» ждёт вашего ответа`,
  notifyStalled: (p: { title: string }) => `«${p.title}» застряло`,
  notifyReminder: (p: { title: string }) => `Напоминание: ${p.title}`,

  // ---- 提议 ----
  proposalNotFound: 'Эта карточка больше недоступна.',
  proposalHandled: 'Эта карточка уже обработана.',
  chipStale: 'Эти предложения устарели.',
  userOnly: 'Это может сделать только сам пользователь.',
  notReady: 'Режим Bot ещё не готов.',
  automationPaused: 'Автоматизация приостановлена.',
};
