import type { LegacyImportMessages } from './legacy-import-copy.ts';

export const vi: LegacyImportMessages = {
  title: 'Nhập dự án từ phiên bản trước?',
  lead: (n) =>
    `Máy tính này có ${n} dự án từ phiên bản BaoCut trước. Nhập vào để tiếp tục chỉnh sửa trong phiên bản này. Tệp gốc vẫn ở nguyên chỗ cũ, không bị thay đổi.`,
  found: 'Dự án tìm thấy',
  destination: 'Nhập vào',
  resetDefault: 'Dùng vị trí mặc định',
  change: 'Đổi…',
  pickTitle: 'Chọn nơi nhập',
  destinationNote: 'Thư mục này xuất hiện trong Home như một dự án, mỗi dự án cũ trở thành một video trong đó.',
  hint: 'Nếu bỏ qua, BaoCut sẽ hỏi lại ở lần khởi động sau. Đánh dấu “Không nhắc lại” để không bao giờ nhập.',
  never: 'Không nhắc lại',
  skip: 'Bỏ qua',
  import: 'Nhập',
  importing: (n) => `Đang nhập ${n} dự án cũ ở chế độ nền`,
  neverDone: 'Sẽ không nhắc nhập dự án cũ nữa. Tệp gốc vẫn giữ nguyên.',
  skipped: 'Đã bỏ qua. BaoCut sẽ hỏi lại ở lần khởi động sau.',
  failed: (message) => `Không nhập được: ${message}`,
};
