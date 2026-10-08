import type { ServicesMessages } from './services.ts';

export const vi: ServicesMessages = {
portRange: 'Nhập số cổng từ 1024 đến 65535', portTaken: (port, service) => `${port} đã được “${service}” dùng; chọn cổng khác`, browser: 'Trình duyệt', sessionMeta: (connections, ago, expires) => [connections ? `${connections} kết nối` : 'Không có kết nối', `Hoạt động ${ago}`, expires ? `Hết hạn lúc ${expires}` : null].filter(Boolean).join(' · '), runtime: { connected: 'Đã kết nối', incompatible: 'Phiên bản không tương thích', disconnected: 'Chưa kết nối' },
};
