import type { ClientConnectionMessages } from './client-connection.ts';

export const vi: ClientConnectionMessages = {
  closed: 'Máy khách đã đóng',
  disconnected: 'Đã mất kết nối với Runtime',
  connectionLost: 'Mất kết nối',
  cannotConnect: 'Không thể kết nối Runtime',
  requestTimedOut: (p) => `Yêu cầu hết thời gian chờ: ${p.method}`,
  unknownError: 'Lỗi không xác định',
};
