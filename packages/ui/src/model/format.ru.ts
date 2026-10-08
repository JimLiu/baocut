import { pluralForm } from '@baocut/protocol';
import type { FormatMessages } from './format.ts';

export const ru: FormatMessages = {
  hoursMinutes: (h: number, m: number) => `${h} ч ${m} мин`,
  hours: (h: number) => `${h} ч`,
  minutesSeconds: (m: number, s: number) => `${m} мин ${s} с`,
  minutes: (m: number) => `${m} мин`,
  seconds: (s: number) => `${s} с`,
  justNow: "только что",
  minutesAgo: (n: number) => `${n} мин назад`,
  hoursAgo: (n: number) => pluralForm('ru', n, { one: `${n} час назад`, few: `${n} часа назад`, many: `${n} часов назад`, other: `${n} часа назад` }),
  yesterday: "Вчера",
  dateThisYear: (date: Date) => new Intl.DateTimeFormat('ru', { month: 'short', day: 'numeric' }).format(date),
  dateWithYear: (date: Date) => new Intl.DateTimeFormat('ru', { year: 'numeric', month: 'short', day: 'numeric' }).format(date),
};
