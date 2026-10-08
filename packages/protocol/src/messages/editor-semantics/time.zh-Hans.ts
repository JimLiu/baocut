import type { TimeMessages } from './time.ts';

export const zhHans: TimeMessages = {
  rateNotPositive: '帧率的分子与分母必须为正',
  rateNotReduced: '帧率必须约分',
  timescaleNotPositive: 'timescale 必须大于 0',
  notInteger: (p) => `不是十进制整数："${p.text}"`,
  leadingZero: '整数不能有前导零',
  notDecimalSeconds: (p) => `不是十进制秒："${p.text}"`,
  negativePosition: '绝对位置不能为负',
};
