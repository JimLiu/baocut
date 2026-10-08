import type { ModelsModelDownloaderMessages } from './model-downloader.ts';

export const vi: ModelsModelDownloaderMessages = {
remedyNoSpace: 'Đĩa chứa thư mục mô hình đã hết dung lượng. Giải phóng đủ dung lượng (hoặc chuyển thư mục mô hình sang đĩa khác trong Cài đặt), rồi cài lại',
remedyNetwork: 'Không thể truy cập mạng hoặc tải xuống bị gián đoạn. Kiểm tra mạng và cài lại; phần đã tải sẽ tiếp tục. Bạn cũng có thể đổi máy chủ mirror trong “Nguồn tải mô hình” tại “Cài đặt › Chung”',
remedyIntegrity: 'Tệp đã tải không khớp kích thước hoặc sha256 trong bản kê (nguồn hoặc mirror có nội dung sai). Đã xóa tệp lỗi; đổi nguồn tải khác rồi cài lại',
remedySource: 'Nguồn tải không có tệp này hoặc từ chối truy cập. Kiểm tra mirror đặt trong “Nguồn tải mô hình” tại “Cài đặt › Chung” (hoặc biến môi trường BAOCUT_MODELS_ENDPOINT) có đầy đủ hay không',
remedyManifestIncomplete: 'Bản kê có sẵn cho gói mô hình này thiếu sha256 đáng tin cậy nên không thể cài. Chờ bản cập nhật BaoCut',
downloadFailed: (p) => `Không tải xuống được ${p.file}: ${p.reason}`, integrityMismatch: (p) => `Kích thước hoặc sha256 của ${p.file} không khớp bản kê`, sourceHttp: (p) => `Nguồn tải trả về HTTP ${p.status} cho ${p.file}`, diskFull: 'Đĩa đầy khi ghi tệp mô hình',
};
