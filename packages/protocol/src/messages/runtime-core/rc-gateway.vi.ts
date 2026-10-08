import type { RcGatewayMessages } from './rc-gateway.ts';

export const vi: RcGatewayMessages = {
helloTimeout: 'Bắt tay hết thời gian chờ', textFramesOnly: 'Chỉ nhận khung văn bản', frameNotJson: 'Khung không phải JSON hợp lệ', frameUnrecognized: 'Khung không được nhận dạng', unknownMethod: (p) => `Phương thức không xác định: ${p.method}`, invalidParams: 'Tham số không hợp lệ', helloRequired: 'Khung đầu phải là hello', invalidToken: 'Token không hợp lệ', protocolMismatch: (p) => `Phiên bản giao thức không tương thích: máy khách ${p.client}, Runtime ${p.runtime}`, internalError: 'Lỗi nội bộ', catalogLocalOnly: 'Danh mục công cụ chỉ khả dụng cho CLI cục bộ và ứng dụng máy tính',
};
