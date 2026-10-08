import type { FontSettingsMessages } from './font-settings-copy.ts';
import { intlLocale } from '@baocut/protocol';

export const vi: FontSettingsMessages = {
 lead: (total) => `Phông chữ có ba nguồn: đi kèm ứng dụng, được cài trên máy tính này và danh mục Google Fonts (${total === null ? 'khoảng hai nghìn' : `khoảng ${total.toLocaleString(intlLocale())}`} họ phông chữ, giấy phép nguồn mở, tải xuống khi cần). Việc tải xuống chỉ gửi tên họ phông chữ và độ đậm, không cần tài khoản; phông chữ được lưu trong dữ liệu ứng dụng, không trong thư mục video.`,
 download: 'Tải xuống', autoDownload: 'Tự động tải xuống phông chữ', autoDownloadDesc: 'Tải xuống từ Google Fonts khi xem trước, mở video hoặc xuất cần phông chữ chưa có trên máy tính này. Khi tắt, phông chữ thay thế được dùng trước để hiển thị và xuất; bạn vẫn có thể tải xuống thủ công lúc chọn phông chữ. Không tải xuống khi bật ngoại tuyến nghiêm ngặt.',
 cssEndpoint: 'URL biểu định kiểu', cssEndpointDesc: 'URL gốc của máy chủ mirror. Để trống để dùng https://fonts.googleapis.com.', fileEndpoint: 'URL tệp phông chữ', fileEndpointDesc: 'Chỉ lấy tệp phông chữ từ dưới URL này. Để trống để dùng https://fonts.gstatic.com.',
 downloaded: 'Phông chữ đã tải xuống', summary: (families, size) => `${families} họ phông chữ · ${size}`, none: 'Chưa có', clearAll: 'Xóa hết', empty: 'Phông chữ tải xuống lúc chọn phông chữ, hoặc tự động khi mở video hay xuất, được liệt kê ở đây.',
 clearTitle: 'Xóa phông chữ đã tải xuống?', clear: 'Xóa', cancel: 'Hủy', removed: (family, size) => `Đã xóa “${family}” · Giải phóng ${size}`, inUseTip: 'Bản xuất chưa xong đang dùng phông chữ này; hãy xóa sau khi xuất xong', removeTip: 'Xóa tệp đã tải xuống của phông chữ này', removeLabel: (tip, family) => `${tip}: ${family}`, facts: (weights, size, licence, ago) => `Độ đậm ${weights} · ${size} · ${licence}${ago ? ` · Đã tải xuống ${ago}` : ''}`, inUse: 'Đang dùng để xuất',
};
