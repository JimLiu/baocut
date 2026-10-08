import type { FormatMessages } from './format.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: FormatMessages = {
  hoursMinutes: (h: number, m: number) => `${h} h ${m} min`,
  hours: (h: number) => `${h} h`,
  minutesSeconds: (m: number, s: number) => `${m} min ${s} s`,
  minutes: (m: number) => `${m} min`,
  seconds: (s: number) => `${s} s`,
  justNow: 'Agora mesmo',
  minutesAgo: (n: number) => `há ${n} min`,
  hoursAgo: (n: number) => pluralForm('pt-BR', n, { one: `há ${n} hora`, other: `há ${n} horas` }),
  yesterday: 'Ontem',
  dateThisYear: (date: Date) => new Intl.DateTimeFormat('pt-BR', { month: 'short', day: 'numeric' }).format(date),
  dateWithYear: (date: Date) => new Intl.DateTimeFormat('pt-BR', { year: 'numeric', month: 'short', day: 'numeric' }).format(date),
};
