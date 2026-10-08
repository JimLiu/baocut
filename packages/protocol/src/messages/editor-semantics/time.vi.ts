import type { TimeMessages } from './time.ts';

export const vi: TimeMessages = {
  rateNotPositive: 'Tử số và mẫu số của tốc độ khung hình phải dương',
  rateNotReduced: 'Tốc độ khung hình phải được rút gọn',
  timescaleNotPositive: 'timescale phải lớn hơn 0',
  notInteger: (p) => `Không phải số nguyên thập phân: “${p.text}”`,
  leadingZero: 'Số nguyên không được có số 0 ở đầu',
  notDecimalSeconds: (p) => `Không phải giây thập phân: “${p.text}”`,
  negativePosition: 'Vị trí tuyệt đối không được âm',
};
