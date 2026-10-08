import { intlLocale } from "@baocut/protocol";
import { pluralForm } from '@baocut/protocol';
import type { FormatMessages } from './format.ts';

export const de: FormatMessages = {
  hoursMinutes: (h: number, m: number) => `${h} Std. ${m} min`,
  hours: (h: number) => `${h} Std.`,
  minutesSeconds: (m: number, s: number) => `${m} min ${s} s`,
  minutes: (m: number) => `${m} min`,
  seconds: (s: number) => `${s} s`,
  justNow: "Gerade eben",
  minutesAgo: (n: number) => `${n} min zuvor`,
  hoursAgo: (n: number) => (pluralForm('de', n, { one: "Vor 1 Stunde", other: `${n} Stunden zuvor` })),
  yesterday: "Gestern",
  dateThisYear: (date: Date) => new Intl.DateTimeFormat('de-DE', { month: "short", day: "numeric" }).format(date),
  dateWithYear: (date: Date) => new Intl.DateTimeFormat('de-DE', { year: "numeric", month: "short", day: "numeric" }).format(date),
};
