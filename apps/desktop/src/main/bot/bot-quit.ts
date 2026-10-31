import type { MessageBoxOptions } from 'electron';
import { intlLocale, type BotStatus } from '@baocut/protocol';
import { B } from './bot-copy.ts';

/**
 * 常驻时的两个确认框（技术方案 §15.2）：
 * - 退出应用（`before-quit`）：Bot 会在后台继续工作；「保持后台」「彻底退出」「取消」。缺省保持后台，回车不会停掉活。
 * - 托盘的「退出后台服务」：列出会被停掉的进行中任务与即将到点的定时任务，确认后停 Runtime 并退出。
 */

export type ResidentQuitChoice = 'keep' | 'quit' | 'cancel';

const RESIDENT_CHOICES: readonly ResidentQuitChoice[] = ['keep', 'quit', 'cancel'];

/** 每组最多列几项，多出来的合成「还有 N 项」。 */
const LISTED = 5;

export function residentQuitPrompt(status: BotStatus | null, platform: NodeJS.Platform, timeZone: string | null = null): MessageBoxOptions {
  return {
    type: 'question',
    message: B.residentQuitTitle,
    detail: (platform === 'darwin' ? B.residentQuitDetailMac : B.residentQuitDetailOther) + workLines(status, timeZone),
    buttons: [B.residentKeep, B.residentQuit, B.cancel],
    defaultId: 0,
    cancelId: RESIDENT_CHOICES.indexOf('cancel'),
    noLink: true,
  };
}

export function residentQuitChoice(response: number): ResidentQuitChoice {
  return RESIDENT_CHOICES[response] ?? 'cancel';
}

/** 「退出后台服务」的确认：第一个按钮是退出，取消是缺省（这一步会停掉进行中的活）。 */
export function quitServicePrompt(status: BotStatus | null, timeZone: string | null = null): MessageBoxOptions {
  return {
    type: 'warning',
    message: B.quitServiceTitle,
    detail: B.quitServiceDetail + workLines(status, timeZone),
    buttons: [B.quitServiceConfirm, B.cancel],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
}

export function quitServiceConfirmed(response: number): boolean {
  return response === 0;
}

/** 进行中的任务与即将到点的定时任务，各一段；都没有时空串。 */
export function workLines(status: BotStatus | null, timeZone: string | null = null): string {
  if (!status) return '';
  const sections: string[] = [];
  if (status.workingThreads.length > 0) {
    sections.push([B.quitServiceThreads(status.workingThreads.length), ...bullets(status.workingThreads.map((task) => task.title))].join('\n'));
  }
  if (status.nextSchedules.length > 0) {
    const format = dateFormat(timeZone);
    const lines = status.nextSchedules.map((schedule) => B.quitServiceScheduleLine(schedule.name, formatAt(format, schedule.nextAt)));
    sections.push([B.quitServiceSchedules(status.nextSchedules.length), ...bullets(lines)].join('\n'));
  }
  return sections.map((section) => `\n\n${section}`).join('');
}

function bullets(lines: readonly string[]): string[] {
  const shown = lines.slice(0, LISTED).map((line) => `• ${line}`);
  if (lines.length > LISTED) shown.push(B.more(lines.length - LISTED));
  return shown;
}

function dateFormat(timeZone: string | null): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
  try {
    return new Intl.DateTimeFormat(intlLocale(), timeZone ? { ...options, timeZone } : options);
  } catch {
    return new Intl.DateTimeFormat(intlLocale(), options);
  }
}

function formatAt(format: Intl.DateTimeFormat, iso: string): string {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? format.format(time) : iso;
}
