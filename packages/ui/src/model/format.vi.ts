import type { FormatMessages } from './format.ts';

export const vi: FormatMessages = {
hoursMinutes: (h, m) => `${h} giờ ${m} phút`, hours: (h) => `${h} giờ`, minutesSeconds: (m, s) => `${m} phút ${s} giây`, minutes: (m) => `${m} phút`, seconds: (s) => `${s} giây`, justNow: 'Vừa xong', minutesAgo: (n) => `${n} phút trước`, hoursAgo: (n) => `${n} giờ trước`, yesterday: 'Hôm qua', dateThisYear: (date) => new Intl.DateTimeFormat('vi-VN', { month: 'short', day: 'numeric' }).format(date), dateWithYear: (date) => new Intl.DateTimeFormat('vi-VN', { year: 'numeric', month: 'short', day: 'numeric' }).format(date),
};
