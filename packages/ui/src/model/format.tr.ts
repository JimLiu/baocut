import type { FormatMessages } from './format.ts';

export const tr: FormatMessages = {
hoursMinutes: (h, m) => `${h} sa ${m} dk`, hours: (h) => `${h} sa`, minutesSeconds: (m, s) => `${m} dk ${s} sn`, minutes: (m) => `${m} dk`, seconds: (s) => `${s} sn`, justNow: 'Az önce', minutesAgo: (n) => `${n} dk önce`, hoursAgo: (n) => `${n} saat önce`, yesterday: 'Dün', dateThisYear: (date) => new Intl.DateTimeFormat('tr-TR', { month: 'short', day: 'numeric' }).format(date), dateWithYear: (date) => new Intl.DateTimeFormat('tr-TR', { year: 'numeric', month: 'short', day: 'numeric' }).format(date),
};
