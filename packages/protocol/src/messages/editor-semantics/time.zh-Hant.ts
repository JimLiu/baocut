import type { TimeMessages } from './time.ts';

export const zhHant: TimeMessages = {
  rateNotPositive: '影格速率的分子與分母必須為正數',
  rateNotReduced: '影格速率必須是最簡分數',
  timescaleNotPositive: 'timescale 必須大於 0',
  notInteger: (p) => `不是十進位整數：「${p.text}」`,
  leadingZero: '整數不能有前導零',
  notDecimalSeconds: (p) => `不是十進位秒數：「${p.text}」`,
  negativePosition: '絕對位置不能為負數',
};
