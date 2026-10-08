import { pluralForm } from '@baocut/protocol';
import type { FormatMessages } from './format.ts';

export const pl: FormatMessages = {
  hoursMinutes: (h: number, m: number) => `${h} godz. ${m} min`,
  hours: (h: number) => `${h} godz.`,
  minutesSeconds: (m: number, s: number) => `${m} min ${s} s`,
  minutes: (m: number) => `${m} min`,
  seconds: (s: number) => `${s} s`,
  justNow: "Właśnie teraz",
  minutesAgo: (n: number) => `${n} min temu`,
  hoursAgo: (n: number) => pluralForm('pl', n, { one: `${n} godzinę temu`, few: `${n} godziny temu`, many: `${n} godzin temu`, other: `${n} godziny temu` }),
  yesterday: "Wczoraj",
  dateThisYear: (date: Date) => new Intl.DateTimeFormat('pl', { month: 'short', day: 'numeric' }).format(date),
  dateWithYear: (date: Date) => new Intl.DateTimeFormat('pl', { year: 'numeric', month: 'short', day: 'numeric' }).format(date),
};
