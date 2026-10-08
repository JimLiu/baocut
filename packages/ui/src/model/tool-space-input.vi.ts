import type { ToolSpaceInputMessages } from './tool-space-input.ts';

export const vi: ToolSpaceInputMessages = {
  reasons: {
    trashed: 'Trong Thùng rác',
    generating: 'Vẫn đang tạo; bạn có thể chọn khi hoàn tất',
    missing: 'Thiếu tệp; hãy kết nối lại trước khi chọn',
    failed: 'Lần tạo trước thất bại',
    textOnly: 'Chỉ đọc được văn bản trong tài liệu .txt và .md',
    subtitleOnly: 'Chỉ nhận phụ đề .srt và .vtt',
    noPath: 'Mục này không có tệp trên máy tính này; video mới phải bắt đầu từ tệp cục bộ',
  },
  joinKinds: (labels) => labels.join(', '),
};
