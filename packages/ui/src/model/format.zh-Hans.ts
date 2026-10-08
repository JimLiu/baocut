import type { FormatMessages } from './format.ts';

export const zhHans: FormatMessages = {
  hoursMinutes: (h: number, m: number) => `${h} 小时 ${m} 分`,
  hours: (h: number) => `${h} 小时`,
  minutesSeconds: (m: number, s: number) => `${m} 分 ${s} 秒`,
  minutes: (m: number) => `${m} 分`,
  seconds: (s: number) => `${s} 秒`,
  justNow: '刚刚',
  minutesAgo: (n: number) => `${n} 分钟前`,
  hoursAgo: (n: number) => `${n} 小时前`,
  yesterday: '昨天',
  dateThisYear: (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`,
  dateWithYear: (date: Date) => `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`,
};
