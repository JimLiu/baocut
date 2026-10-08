import type { FormatMessages } from './format.ts';

export const zhHant: FormatMessages = {
  hoursMinutes: (h: number, m: number) => `${h} 小時 ${m} 分`,
  hours: (h: number) => `${h} 小時`,
  minutesSeconds: (m: number, s: number) => `${m} 分 ${s} 秒`,
  minutes: (m: number) => `${m} 分`,
  seconds: (s: number) => `${s} 秒`,
  justNow: '剛剛',
  minutesAgo: (n: number) => `${n} 分鐘前`,
  hoursAgo: (n: number) => `${n} 小時前`,
  yesterday: '昨天',
  dateThisYear: (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`,
  dateWithYear: (date: Date) => `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`,
};
