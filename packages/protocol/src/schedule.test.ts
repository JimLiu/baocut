import { afterAll, describe, expect, it } from 'vitest';
import {
  nextScheduleRun,
  parseCron,
  scheduleCron,
  scheduleDefaultName,
  scheduleOccurrences,
  scheduleProblem,
  type ScheduleCadence,
} from './schedule.ts';

/** 定时任务的频率（产品设计 §6.1「定时任务」）：按本机时区算。钉在有夏令时的纽约，覆盖跳过与重复的那一小时。 */
const previousTz = process.env.TZ;
process.env.TZ = 'America/New_York';
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const cron = (expr: string): ScheduleCadence => ({ type: 'cron', expr });
const next = (cadence: ScheduleCadence, from: number) => {
  const t = nextScheduleRun(cadence, from);
  return t === null ? null : new Date(t).toString().slice(0, 24);
};
const local = (t: number) => new Date(t).toString().slice(0, 24);

describe('parseCron', () => {
  it('认 *、n、a-b、*/k、a-b/k 与逗号；周的 7 是周日', () => {
    const parsed = parseCron('*/15 9-17/4 1,15 * 1-5,7');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect([...parsed.cron.minutes]).toEqual([0, 15, 30, 45]);
    expect([...parsed.cron.hours]).toEqual([9, 13, 17]);
    expect([...parsed.cron.days]).toEqual([1, 15]);
    expect([...parsed.cron.weekdays].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(parsed.cron.anyHour).toBe(false);
  });

  it('段数不对、看不懂与超出范围分别给出是哪一段', () => {
    expect(parseCron('0 9 * *')).toEqual({ ok: false, problem: { code: 'cron-fields' } });
    expect(parseCron('0 nine * * *')).toEqual({ ok: false, problem: { code: 'cron-syntax', field: 1, part: 'nine' } });
    expect(parseCron('0 9 * 13 *')).toEqual({ ok: false, problem: { code: 'cron-range', field: 3, part: '13', min: 1, max: 12 } });
    expect(parseCron('0 9 5-1 * *')).toMatchObject({ ok: false, problem: { code: 'cron-range', field: 2 } });
  });
});

describe('scheduleCron', () => {
  it('别的频率换成等价的 cron', () => {
    expect(scheduleCron({ type: 'hourly', minute: 5 })).toBe('5 * * * *');
    expect(scheduleCron({ type: 'daily', time: '09:30' })).toBe('30 9 * * *');
    expect(scheduleCron({ type: 'weekly', days: [4, 1, 4], time: '21:00' })).toBe('0 21 * * 1,4');
  });
});

describe('nextScheduleRun', () => {
  it('严格在 from 之后：正好在点上时是下一次', () => {
    const daily: ScheduleCadence = { type: 'daily', time: '09:00' };
    expect(next(daily, at(2026, 10, 30, 8, 59) + 30_000)).toBe('Fri Oct 30 2026 09:00:00');
    expect(next(daily, at(2026, 10, 30, 9, 0))).toBe('Sat Oct 31 2026 09:00:00');
  });

  it('每周选的几天；跨月、跨年', () => {
    const weekly: ScheduleCadence = { type: 'weekly', days: [1, 4], time: '09:00' };
    expect(next(weekly, at(2026, 10, 30, 12))).toBe('Mon Nov 02 2026 09:00:00');
    expect(next(cron('0 9 31 * *'), at(2027, 1, 31, 10))).toBe('Wed Mar 31 2027 09:00:00');
    expect(next(cron('0 0 1 1 *'), at(2026, 12, 31, 23, 59))).toBe('Fri Jan 01 2027 00:00:00');
  });

  it('2 月 29 日找到闰年；2 月 30 日没有下一次', () => {
    expect(next(cron('0 0 29 2 *'), at(2026, 3, 1))).toBe('Tue Feb 29 2028 00:00:00');
    expect(next(cron('0 0 30 2 *'), at(2026, 3, 1))).toBeNull();
  });

  it('日与周都限定时满足其一就算', () => {
    // 13 号或周五：2026-11 的 6 号是周五，13 号也是周五。
    expect(next(cron('0 9 13 * 5'), at(2026, 11, 1))).toBe('Fri Nov 06 2026 09:00:00');
    expect(next(cron('0 9 13 * 1'), at(2026, 11, 10))).toBe('Fri Nov 13 2026 09:00:00');
  });

  it('夏令时跳过的那一小时：那天这一刻不跑，按小时的照常隔一小时', () => {
    // 2026-03-08 02:00 拨到 03:00。
    expect(next({ type: 'daily', time: '02:30' }, at(2026, 3, 7, 3))).toBe('Mon Mar 09 2026 02:30:00');
    const before = at(2026, 3, 8, 1, 30);
    const t = nextScheduleRun({ type: 'hourly', minute: 30 }, before)!;
    expect(local(t)).toBe('Sun Mar 08 2026 03:30:00');
    expect(t - before).toBe(60 * 60_000);
  });

  it('回拨时重复的那一小时：固定时刻只跑第一次，按小时的两次都跑', () => {
    // 2026-11-01 02:00 拨回 01:00；new Date(…, 1, 30) 取第一次的 01:30。
    const first = at(2026, 11, 1, 1, 30);
    expect(next({ type: 'daily', time: '01:30' }, first)).toBe('Mon Nov 02 2026 01:30:00');
    const second = nextScheduleRun({ type: 'hourly', minute: 30 }, first)!;
    expect(second - first).toBe(60 * 60_000);
    expect(local(second)).toBe('Sun Nov 01 2026 01:30:00');
    expect(nextScheduleRun({ type: 'hourly', minute: 30 }, second)! - second).toBe(60 * 60_000);
  });
});

describe('scheduleOccurrences', () => {
  it('(from, to] 之间到点几次，数到上限为止', () => {
    const hourly: ScheduleCadence = { type: 'hourly', minute: 0 };
    expect(scheduleOccurrences(hourly, at(2026, 10, 30, 9), at(2026, 10, 30, 12))).toBe(3);
    expect(scheduleOccurrences(hourly, at(2026, 10, 30, 9), at(2026, 10, 30, 12), 2)).toBe(2);
    expect(scheduleOccurrences(cron('0 0 30 2 *'), 0, at(2026, 10, 30))).toBe(0);
  });
});

describe('scheduleProblem', () => {
  const ok = { prompt: 'Check the glossary', cadence: { type: 'daily', time: '09:00' } as ScheduleCadence, maxRuns: null };

  it('没问题为 null', () => {
    expect(scheduleProblem(ok)).toBeNull();
    expect(scheduleProblem({ ...ok, maxRuns: 3 })).toBeNull();
  });

  it('逐项检查：话、时刻、星期、分钟、cron、次数', () => {
    expect(scheduleProblem({ ...ok, prompt: '  ' })).toEqual({ code: 'prompt-empty' });
    expect(scheduleProblem({ ...ok, cadence: { type: 'daily', time: '9:00' } })).toEqual({ code: 'time-invalid' });
    expect(scheduleProblem({ ...ok, cadence: { type: 'daily', time: '24:00' } })).toEqual({ code: 'time-invalid' });
    expect(scheduleProblem({ ...ok, cadence: { type: 'weekly', days: [], time: '09:00' } })).toEqual({ code: 'weekly-no-day' });
    expect(scheduleProblem({ ...ok, cadence: { type: 'hourly', minute: 60 } })).toEqual({ code: 'minute-invalid' });
    expect(scheduleProblem({ ...ok, cadence: cron('0 0 30 2 *') }, at(2026, 10, 30))).toEqual({ code: 'cron-never' });
    expect(scheduleProblem({ ...ok, cadence: cron('0 9 * *') })).toEqual({ code: 'cron-fields' });
    expect(scheduleProblem({ ...ok, maxRuns: 0 })).toEqual({ code: 'max-runs-invalid' });
    expect(scheduleProblem({ ...ok, maxRuns: 1.5 })).toEqual({ code: 'max-runs-invalid' });
  });
});

describe('scheduleDefaultName', () => {
  it('取第一行开头，太长的截断', () => {
    expect(scheduleDefaultName('  Check the glossary\nthen report')).toBe('Check the glossary');
    expect(scheduleDefaultName('每天晚上把今天剪过的视频里的术语和术语表核对一遍，有出入的列出来')).toBe(
      '每天晚上把今天剪过的视频里的术语和术语表核对一遍…',
    );
  });
});
