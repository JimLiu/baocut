import type { FormatMessages } from './format.ts';

export const ko: FormatMessages = {
  hoursMinutes: (h: number, m: number) => `${h}시간 ${m}분`,
  hours: (h: number) => `${h}시간`,
  minutesSeconds: (m: number, s: number) => `${m}분 ${s}초`,
  minutes: (m: number) => `${m}분`,
  seconds: (s: number) => `${s}초`,
  justNow: '방금',
  minutesAgo: (n: number) => `${n}분 전`,
  hoursAgo: (n: number) => `${n}시간 전`,
  yesterday: '어제',
  dateThisYear: (date: Date) => `${date.getMonth() + 1}월 ${date.getDate()}일`,
  dateWithYear: (date: Date) => `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`,
};
