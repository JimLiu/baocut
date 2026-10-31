import { intlLocale } from '@baocut/protocol';

/** 截止日、事件日（YYYY-MM-DD，已是用户时区的日期）：按界面语言写成短日期，不再换时区。 */
export function formatDay(day: string): string {
  const time = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(time)) return day;
  return new Intl.DateTimeFormat(intlLocale(), { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(time);
}

/** 时刻（RFC 3339）：按用户时区（`BotSettings.timeZone`，空 = 系统时区）写成短日期加时间。 */
export function formatWhen(iso: string, timeZone: string | null): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  try {
    return new Intl.DateTimeFormat(intlLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timeZone ?? undefined }).format(time);
  } catch {
    return new Intl.DateTimeFormat(intlLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(time);
  }
}
