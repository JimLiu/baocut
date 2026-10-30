import { describe, expect, it } from 'vitest';
import { SCHEDULE_LIMITS, type Conversation, type Schedule, type ScheduleRun } from '@baocut/protocol';
import { SCHEDULE_COPY as C } from '../components/agent-schedule/schedule-copy.ts';
import { S } from '../components/shell-copy.ts';
import {
  cadenceFor,
  describeCadence,
  draftOf,
  nextAtOf,
  outcomeToast,
  problemText,
  resumable,
  runStatus,
  scheduleStatus,
  schedulesOf,
  tookLabel,
  whenLabel,
} from './agent-schedule.ts';

/** 定时任务（产品设计 §6.1「定时任务」）界面要算的东西：频率与时刻的说法、状态词、检查不过时的说明、能不能继续。 */

/** 本机时区的 2026-10-30 12:00，测试不随时区变。 */
const NOW = new Date(2026, 9, 30, 12, 0).getTime();
const at = (month: number, day: number, hour: number, minute: number, year = 2026) =>
  new Date(year, month - 1, day, hour, minute).getTime();

const schedule = (patch: Partial<Schedule>): Schedule => ({
  id: 'sch_1',
  name: 'Morning digest',
  prompt: 'Summarize what changed overnight.',
  cadence: { type: 'daily', time: '09:00' },
  conversationId: 'conv_1',
  target: 'conversation',
  projectId: 'proj_1',
  agent: { driverId: 'claude', model: null, effort: null, accessMode: 'fullAccess' },
  maxRuns: null,
  runCount: 0,
  status: 'active',
  pauseReason: null,
  nextAt: null,
  createdAt: '2026-10-30T00:00:00.000Z',
  updatedAt: '2026-10-30T00:00:00.000Z',
  runs: [],
  ...patch,
});

const run = (patch: Partial<ScheduleRun>): ScheduleRun => ({
  id: 'run_1',
  status: 'done',
  at: '2026-10-30T09:00:00.000Z',
  startedAt: '2026-10-30T09:00:00.000Z',
  endedAt: '2026-10-30T09:02:05.000Z',
  conversationId: 'conv_1',
  taskId: 'task_1',
  error: null,
  ...patch,
});

describe('describeCadence', () => {
  it('每小时写第几分，每天写时刻，cron 原样', () => {
    expect(describeCadence({ type: 'hourly', minute: 5 })).toBe(C.everyHour(5));
    expect(describeCadence({ type: 'daily', time: '09:00' })).toBe(C.everyDay('09:00'));
    expect(describeCadence({ type: 'cron', expr: '0 9 * * 1-5' })).toBe(C.cronCadence('0 9 * * 1-5'));
  });

  it('每周的几天从周一排到周日，按界面语言连起来', () => {
    expect(describeCadence({ type: 'weekly', days: [0, 4, 1], time: '21:00' })).toBe(
      C.everyWeek(S.list([C.weekdays[1]!, C.weekdays[4]!, C.weekdays[0]!]), '21:00'),
    );
  });
});

describe('whenLabel', () => {
  it('今天、明天写时刻；更远的写日期；没有下一次如实说', () => {
    expect(whenLabel(at(10, 30, 18, 5), NOW)).toBe(C.today('18:05'));
    expect(whenLabel(at(10, 31, 9, 0), NOW)).toBe(C.tomorrow('09:00'));
    const later = whenLabel(at(11, 3, 9, 0), NOW);
    expect(later).not.toBe(C.tomorrow('09:00'));
    expect(later.endsWith('09:00')).toBe(true);
    expect(whenLabel(null, NOW)).toBe(C.never);
    expect(whenLabel(Number.NaN, NOW)).toBe(C.never);
  });

  it('跨年的日期带上年份', () => {
    expect(whenLabel(at(1, 2, 9, 0, 2027), NOW)).toContain('2027');
    expect(whenLabel(at(11, 3, 9, 0), NOW)).not.toContain('2026');
  });
});

describe('cadenceFor', () => {
  it('换频率时保留时刻、几天与第几分', () => {
    expect(cadenceFor('weekly', { type: 'daily', time: '21:30' })).toEqual({ type: 'weekly', days: [1], time: '21:30' });
    expect(cadenceFor('daily', { type: 'weekly', days: [2, 4], time: '07:15' })).toEqual({ type: 'daily', time: '07:15' });
    expect(cadenceFor('hourly', { type: 'daily', time: '07:15' })).toEqual({ type: 'hourly', minute: 0 });
    expect(cadenceFor('hourly', { type: 'hourly', minute: 40 })).toEqual({ type: 'hourly', minute: 40 });
    expect(cadenceFor('daily', { type: 'hourly', minute: 40 })).toEqual({ type: 'daily', time: '09:00' });
  });

  it('换成自定义时写成等价的 cron；写不出来时用每天 9 点', () => {
    expect(cadenceFor('cron', { type: 'daily', time: '07:15' })).toEqual({ type: 'cron', expr: '15 7 * * *' });
    expect(cadenceFor('cron', { type: 'weekly', days: [1, 3], time: '21:00' })).toEqual({ type: 'cron', expr: '0 21 * * 1,3' });
    expect(cadenceFor('cron', { type: 'daily', time: 'later' })).toEqual({ type: 'cron', expr: '0 9 * * *' });
    expect(cadenceFor('cron', { type: 'cron', expr: '*/5 * * * *' })).toEqual({ type: 'cron', expr: '*/5 * * * *' });
  });
});

describe('problemText', () => {
  it('cron 的错写明哪一段；长度写明上限', () => {
    expect(problemText({ code: 'cron-syntax', field: 1, part: 'x' })).toBe(C.cronSyntax(C.cronFieldNames[1]!, 'x'));
    expect(problemText({ code: 'cron-range', field: 4, part: '9', min: 0, max: 7 })).toBe(C.cronRange(C.cronFieldNames[4]!, '9', 0, 7));
    expect(problemText({ code: 'name-too-long' })).toBe(C.nameTooLong(SCHEDULE_LIMITS.name));
    expect(problemText({ code: 'weekly-no-day' })).toBe(C.weeklyNoDay);
  });
});

describe('scheduleStatus', () => {
  it('启用的写下一次：有 nextAt 用它，没有时按频率从现在算', () => {
    expect(scheduleStatus(schedule({ nextAt: new Date(at(10, 31, 9, 0)).toISOString() }), NOW)).toEqual({
      label: C.statusNext(C.tomorrow('09:00')),
      tone: 'informative',
    });
    expect(scheduleStatus(schedule({ cadence: { type: 'daily', time: '18:00' } }), NOW).label).toBe(C.statusNext(C.today('18:00')));
  });

  it('暂停写明原因；完成写跑满几次', () => {
    expect(scheduleStatus(schedule({ status: 'paused' }), NOW)).toEqual({ label: C.statusPaused, tone: 'neutral' });
    expect(scheduleStatus(schedule({ status: 'paused', pauseReason: 'conversation-archived' }), NOW).label).toBe(
      C.statusPausedFor(C.pauseReason['conversation-archived']),
    );
    expect(scheduleStatus(schedule({ status: 'completed', maxRuns: 3, runCount: 3 }), NOW)).toEqual({
      label: C.statusCompleted(3),
      tone: 'positive',
    });
  });

  it('不在启用状态时没有下一次', () => {
    expect(nextAtOf(schedule({ status: 'paused', nextAt: '2026-10-31T01:00:00.000Z' }), NOW)).toBeNull();
  });
});

describe('runStatus / tookLabel', () => {
  it('错过的写明几次；别的用状态词', () => {
    expect(runStatus(run({ status: 'missed', count: 4, startedAt: null, endedAt: null }))).toEqual({ label: C.missed(4), tone: 'neutral' });
    expect(runStatus(run({ status: 'missed', startedAt: null }))).toEqual({ label: C.missed(1), tone: 'neutral' });
    expect(runStatus(run({ status: 'failed' }))).toEqual({ label: C.run.failed, tone: 'negative' });
    expect(runStatus(run({ status: 'queued' })).tone).toBe('notice');
  });

  it('发出去到结束用了多久；没发出去或没结束的没有', () => {
    expect(tookLabel(run({}))).toMatch(new RegExp(`^${C.took('').trim()}`));
    expect(tookLabel(run({ endedAt: null }))).toBeNull();
    expect(tookLabel(run({ startedAt: null }))).toBeNull();
    expect(tookLabel(run({ endedAt: '2026-10-30T08:00:00.000Z' }))).toBeNull();
  });
});

describe('resumable', () => {
  const live = { id: 'conv_1', archived: false } as Conversation;
  const archived = { id: 'conv_1', archived: true } as Conversation;

  it('启用的不用继续；目标会话不在或已归档时不能继续', () => {
    expect(resumable(schedule({}), live, true)).toBe(false);
    expect(resumable(schedule({ status: 'paused' }), live, true)).toBe(true);
    expect(resumable(schedule({ status: 'paused' }), archived, true)).toBe(false);
    expect(resumable(schedule({ status: 'paused' }), undefined, true)).toBe(false);
  });

  it('新开会话看项目在不在；跑满的不能继续', () => {
    expect(resumable(schedule({ status: 'paused', target: 'new' }), undefined, true)).toBe(true);
    expect(resumable(schedule({ status: 'paused', target: 'new' }), undefined, false)).toBe(false);
    expect(resumable(schedule({ status: 'completed', maxRuns: 2, runCount: 2 }), live, true)).toBe(false);
  });
});

describe('schedulesOf / outcomeToast / draftOf', () => {
  it('数建在这条会话上的定时任务', () => {
    const list = [schedule({}), schedule({ id: 'sch_2' }), schedule({ id: 'sch_3', conversationId: 'conv_2' })];
    expect(schedulesOf(list, 'conv_1')).toBe(2);
    expect(schedulesOf(list, 'conv_9')).toBe(0);
  });

  it('立即运行一次之后的提示；暂停写明原因', () => {
    expect(outcomeToast('run', schedule({}))).toEqual({ text: C.started, tone: 'positive' });
    expect(outcomeToast('failed', schedule({}))).toEqual({ text: C.startFailed, tone: 'negative' });
    expect(outcomeToast('pause', schedule({ pauseReason: 'project-removed' })).text).toBe(C.paused(C.pauseReason['project-removed']));
  });

  it('新建的草稿每天 9 点、发给这条会话、不限次数；编辑的照抄', () => {
    expect(draftOf(null)).toMatchObject({ name: '', cadence: { type: 'daily', time: '09:00' }, target: 'conversation', limit: false });
    const existing = schedule({ maxRuns: 7, cadence: { type: 'weekly', days: [1], time: '08:00' } });
    const draft = draftOf(existing);
    expect(draft).toMatchObject({ name: 'Morning digest', limit: true, maxRuns: 7, runNow: false });
    expect(draft.cadence).not.toBe(existing.cadence);
  });
});
