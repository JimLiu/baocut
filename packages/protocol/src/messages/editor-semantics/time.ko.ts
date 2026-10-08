import type { TimeMessages } from './time.ts';

export const ko: TimeMessages = {
  rateNotPositive: '프레임 레이트의 분자와 분모는 양수여야 합니다',
  rateNotReduced: '프레임 레이트는 기약분수여야 합니다',
  timescaleNotPositive: 'timescale은 0보다 커야 합니다',
  notInteger: (p) => `10진 정수가 아닙니다: “${p.text}”`,
  leadingZero: '정수 앞에 0을 붙일 수 없습니다',
  notDecimalSeconds: (p) => `10진 초 값이 아닙니다: “${p.text}”`,
  negativePosition: '절대 위치는 음수일 수 없습니다',
};
