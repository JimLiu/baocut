import type { FormatMessages } from './format.ts';

export const ja: FormatMessages = {
  hoursMinutes: (h: number, m: number) => `${h} 時間 ${m} 分`,
  hours: (h: number) => `${h} 時間`,
  minutesSeconds: (m: number, s: number) => `${m} 分 ${s} 秒`,
  minutes: (m: number) => `${m} 分`,
  seconds: (s: number) => `${s} 秒`,
  justNow: 'たった今',
  minutesAgo: (n: number) => `${n} 分前`,
  hoursAgo: (n: number) => `${n} 時間前`,
  yesterday: '昨日',
  dateThisYear: (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`,
  dateWithYear: (date: Date) => `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`,
};
