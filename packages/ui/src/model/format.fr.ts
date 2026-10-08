import type { FormatMessages } from './format.ts';
import { pluralForm } from '@baocut/protocol';

export const fr: FormatMessages = {
  hoursMinutes: (h, m) => `${h} h ${m} min`, hours: (h) => `${h} h`, minutesSeconds: (m, s) => `${m} min ${s} s`, minutes: (m) => `${m} min`, seconds: (s) => `${s} s`, justNow: 'À l’instant', minutesAgo: (n) => `Il y a ${n} min`, hoursAgo: (n) => `Il y a ${n} ${pluralForm('fr', n, { one: 'heure', other: 'heures' })}`, yesterday: 'Hier', dateThisYear: (date) => new Intl.DateTimeFormat('fr-FR', { month: 'short', day: 'numeric' }).format(date), dateWithYear: (date) => new Intl.DateTimeFormat('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' }).format(date),
};
