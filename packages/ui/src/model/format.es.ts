import type { FormatMessages } from './format.ts';
import { pluralForm } from '@baocut/protocol';
export const es: FormatMessages = {
 hoursMinutes: (h, m) => `${h} h ${m} min`, hours: (h) => `${h} h`, minutesSeconds: (m, s) => `${m} min ${s} s`, minutes: (m) => `${m} min`, seconds: (s) => `${s} s`,
 justNow: 'Ahora mismo', minutesAgo: (n) => `Hace ${n} min`,
 hoursAgo: (n) => `Hace ${n} ${pluralForm('es', n, { one: 'hora', other: 'horas' })}`,
 yesterday: 'Ayer',
 dateThisYear: (date) => new Intl.DateTimeFormat('es', { month: 'short', day: 'numeric' }).format(date),
 dateWithYear: (date) => new Intl.DateTimeFormat('es', { year: 'numeric', month: 'short', day: 'numeric' }).format(date),
};
