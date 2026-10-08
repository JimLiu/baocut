import type { ToolOutputsMessages } from './tool-outputs.ts';

export const vi: ToolOutputsMessages = {
  actionLabel: { 'open-movie': 'Mở trong trình chỉnh sửa', 'new-movie': 'Tạo video mới từ đây' },
  blockTextOnly: 'Bản chép lời và phụ đề cần tệp video hoặc âm thanh để tạo video mới; hiện chưa thể làm từ đây',
  blockTrashed: 'Khôi phục mục này từ Thùng rác trước',
  blockGenerating: 'Vẫn đang tạo; có thể dùng khi hoàn tất',
  blockMissing: 'Không tìm thấy tệp của đầu ra này trên máy tính này',
  handover: {
    subtitle: 'Dịch phụ đề này sang ngôn ngữ khác, giữ nguyên mã thời gian.',
    document: 'Viết bản tóm tắt cho bản chép lời này.',
    audio: 'Tạo video bằng âm thanh này.',
    image: 'Tạo video với hình ảnh này làm bìa.',
    'video-file': 'Thêm phụ đề vào video này.',
    export: 'Thêm phụ đề vào video này.',
    video: 'Tiếp tục chỉnh sửa video này.',
  },
  handoverDefault: 'Tiếp tục xử lý kết quả này.',
};
