import { defineMessages, type SchedulePauseReason, type ScheduleRunStatus } from '@baocut/protocol';
import { zhHans } from './schedule-copy.zh-Hans.ts';
import { zhHant } from './schedule-copy.zh-Hant.ts';
import { ja } from './schedule-copy.ja.ts';
import { ko } from './schedule-copy.ko.ts';
import { es } from './schedule-copy.es.ts';
import { fr } from './schedule-copy.fr.ts';
import { de } from './schedule-copy.de.ts';
import { nl } from './schedule-copy.nl.ts';
import { ptBR } from './schedule-copy.pt-BR.ts';
import { it } from './schedule-copy.it.ts';
import { ru } from './schedule-copy.ru.ts';
import { pl } from './schedule-copy.pl.ts';
import { tr } from './schedule-copy.tr.ts';
import { vi } from './schedule-copy.vi.ts';

/**
 * 定时任务（产品设计 §6.1「定时任务」，原型 agent-schedule.jsx）的文案：会话菜单的入口、建立与编辑对话框、后台任务侧栏的「定时」一段
 * 与详情页。英文是键与类型的来源，译文在 `schedule-copy.<语言>.ts`。
 */
const en = {
  /** 会话标题栏 ⋯ 菜单。 */
  menu: 'Run on a schedule…',
  menuCount: (n: number) => (n === 1 ? '1 scheduled task' : `${n} scheduled tasks`),
  /** 建立与编辑。 */
  titleCreate: 'Run on a schedule',
  titleEdit: 'Edit scheduled task',
  name: 'Name',
  nameHint: 'Leave empty to use the start of the message',
  prompt: 'Message to send',
  promptHint: 'Sent to the agent as is each time, just like typing it in the message box',
  cadence: 'Repeat',
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
  custom: 'Custom',
  minute: 'Minute past the hour',
  days: 'Days of the week',
  /** 周日到周六的简称，下标同 `Date.getDay()`。 */
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  time: 'Time',
  cron: 'Cron expression',
  cronHint: 'Five fields: minute hour day month weekday, in this computer’s time zone',
  /** 频率下面一行：说法与下一次。 */
  next: (cadence: string, when: string) => `${cadence} · Next: ${when}`,
  never: 'Never runs',
  target: 'Send to',
  targetConversation: (title: string) => `This session, “${title}”`,
  targetGone: 'The original session (deleted)',
  targetNew: (project: string) => `A new session in project “${project}” each time`,
  targetNewNoProject: 'A new session each time (this session isn’t in a project)',
  limit: 'Stop after a number of runs',
  maxRuns: 'Maximum runs',
  note: 'Runs only while BaoCut is open. Runs missed while it’s closed aren’t made up; the history logs them as missed. If the previous run hasn’t finished, this one is skipped. If the session is busy, it waits until the session is free.',
  accessHint: (mode: string) =>
    `This session’s access mode is “${mode}”. With nobody watching, anything that needs your permission or an answer waits there until you’re back.`,
  runNow: 'Run once right after creating',
  create: 'Create',
  created: (name: string, cadence: string) => `Created “${name}” · ${cadence}`,
  view: 'View',
  saved: 'Scheduled task saved',
  saveFailed: (error: string) => `Couldn’t save the scheduled task: ${error}`,
  /** 检查不过时频率下面那一行（`ScheduleProblem`）。 */
  promptEmpty: 'Write a message to send each time',
  nameTooLong: (max: number) => `Use at most ${max} characters for the name`,
  promptTooLong: (max: number) => `Use at most ${max} characters for the message`,
  minuteInvalid: 'The minute must be 0–59',
  timeInvalid: 'Write the time like 09:00',
  weeklyNoDay: 'Pick at least one day',
  cronFields: 'A cron expression has five fields: minute hour day month weekday',
  /** cron 的五段，下标同 `CronField`。 */
  cronFieldNames: ['minute', 'hour', 'day', 'month', 'weekday'],
  cronSyntax: (field: string, part: string) => `Can’t read “${part}” in the ${field} field`,
  cronRange: (field: string, part: string, min: number, max: number) => `“${part}” in the ${field} field is outside ${min}–${max}`,
  cronNever: 'This expression never comes around',
  maxRunsInvalid: 'Maximum runs must be a whole number of at least 1',
  /** 频率的说法。 */
  everyHour: (minute: number) => `Hourly at minute ${minute}`,
  everyDay: (time: string) => `Daily at ${time}`,
  everyWeek: (days: string, time: string) => `Every ${days} at ${time}`,
  cronCadence: (expr: string) => `cron ${expr}`,
  /** 什么时候：今天 / 明天 / 某月某日（`date` 按界面语言排好）。 */
  today: (time: string) => `today ${time}`,
  tomorrow: (time: string) => `tomorrow ${time}`,
  onDate: (date: string, time: string) => `${date} ${time}`,
  /** 定时任务的状态。 */
  statusNext: (when: string) => `Next: ${when}`,
  statusPaused: 'Paused',
  statusPausedFor: (reason: string) => `Paused: ${reason}`,
  pauseReason: {
    'conversation-archived': 'session archived',
    'conversation-deleted': 'session deleted',
    'project-removed': 'project removed',
  } satisfies Record<SchedulePauseReason, string>,
  statusCompleted: (n: number) => `Completed (${n} ${n === 1 ? 'run' : 'runs'})`,
  /** 详情页。 */
  notFound: 'This scheduled task has been deleted',
  runOnce: 'Run once now',
  pause: 'Pause',
  resume: 'Resume',
  actions: 'Scheduled task actions',
  edit: 'Edit…',
  remove: 'Delete…',
  removeTitle: (name: string) => `Delete “${name}”?`,
  removeBody: 'Only the scheduled task is deleted. The sessions it ran and their results stay.',
  removeConfirm: 'Delete',
  removeFailed: (error: string) => `Couldn’t delete: ${error}`,
  whyArchived: 'To resume, restore that session from Archived sessions, or edit the scheduled task to open a new session each time.',
  whyOther: 'To resume, edit the scheduled task and pick another target.',
  localTime: 'this computer’s time zone',
  sessionGone: '(session deleted)',
  projectGone: 'removed project',
  runs: 'Runs',
  runsUnlimited: (n: number) => `No limit · ran ${n} ${n === 1 ? 'time' : 'times'}`,
  runsLimited: (max: number, n: number) => `Up to ${max} · ran ${n} ${n === 1 ? 'time' : 'times'}`,
  promptEach: 'Message sent each time',
  history: 'Run history',
  noRuns: 'Hasn’t run yet.',
  /** 还没跑过、启用时：连同下一次一句说完。 */
  noRunsNext: (when: string) => `Hasn’t run yet. Next run ${when}.`,
  took: (duration: string) => `Took ${duration}`,
  openSession: 'Open session',
  run: {
    running: 'Running',
    queued: 'Waiting for the session',
    done: 'Done',
    failed: 'Failed',
    skipped: 'Skipped: previous run still going',
    missed: 'Missed',
  } satisfies Record<ScheduleRunStatus, string>,
  missed: (n: number) => `Missed ${n} ${n === 1 ? 'time' : 'times'} (BaoCut wasn’t open)`,
  /** 「立即运行一次」之后的提示。 */
  started: 'Started',
  queued: 'The session is busy; it’ll be sent once the session is free',
  skipped: 'The previous run is still going, so this one was skipped',
  paused: (reason: string) => `Paused: ${reason}`,
  completed: 'Reached the maximum runs; marked completed',
  startFailed: 'Couldn’t start this run; see the run history',
  runFailed: (error: string) => `Couldn’t run: ${error}`,
  /** 后台任务侧栏的段头。 */
  section: (n: number) => `Scheduled · ${n}`,
};

export type ScheduleMessages = typeof en;

export const SCHEDULE_COPY = defineMessages(en, {
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
  ja,
  ko,
  es,
  fr,
  de,
  nl,
  'pt-BR': ptBR,
  it,
  ru,
  pl,
  tr,
  vi,
});
