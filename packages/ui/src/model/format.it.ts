import type { FormatMessages } from './format.ts';
import { pluralForm } from '@baocut/protocol';

export const it: FormatMessages = {
  hoursMinutes: (h: number, m: number) => `${h} h ${m} min`,
  hours: (h: number) => `${h} h`,
  minutesSeconds: (m: number, s: number) => `${m} min ${s} s`,
  minutes: (m: number) => `${m} min`,
  seconds: (s: number) => `${s} s`,
  justNow: 'Ora',
  minutesAgo: (n: number) => `${n} min fa`,
  hoursAgo: (n: number) => pluralForm('it', n, { one: `${n} ora fa`, other: `${n} ore fa` }),
  yesterday: 'Ieri',
  dateThisYear: (date: Date) => new Intl.DateTimeFormat('it', { month: 'short', day: 'numeric' }).format(date),
  dateWithYear: (date: Date) => new Intl.DateTimeFormat('it', { year: 'numeric', month: 'short', day: 'numeric' }).format(date),
};
