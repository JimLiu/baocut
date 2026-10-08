import type { TimeMessages } from './time.ts';

export const ja: TimeMessages = {
  rateNotPositive: 'フレームレートの分子と分母は正の数である必要があります',
  rateNotReduced: 'フレームレートは既約分数である必要があります',
  timescaleNotPositive: 'timescale は 0 より大きい必要があります',
  notInteger: (p) => `10 進整数ではありません：「${p.text}」`,
  leadingZero: '整数の先頭に 0 は付けられません',
  notDecimalSeconds: (p) => `10 進数の秒数ではありません：「${p.text}」`,
  negativePosition: '絶対位置を負の値にすることはできません',
};
