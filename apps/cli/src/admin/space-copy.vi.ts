import type { SpaceMessages } from './space-copy.ts';

export const vi: SpaceMessages = {
help: `Cách dùng:
  baocut space rescan              Quét lại thư mục nguồn
  baocut space rebuild             Tạo lại danh mục Space từ thư mục nguồn và bản ghi;
                                   chỉ mục nội dung đọc lại mọi video trong nền
  baocut space trash|restore <entry id>
                                   Chuyển vào / khôi phục từ Thùng rác (không đụng đến tệp;
                                   mục video sẽ chuyển thư mục video vào / ra Thùng rác)
  baocut space purge <entry id>    Xóa vĩnh viễn mục trong Thùng rác; không xóa khi video hoặc tác vụ
                                   vẫn dùng và sẽ liệt kê tham chiếu
  baocut space delete-video <entry id>
                                   Xóa video: chuyển thư mục video vào Thùng rác, có thể khôi phục trong thời hạn lưu;
                                   không đụng đến tệp gốc của tư liệu liên kết
  baocut space continue <entry id> [--conversation <session id>]
                                   Tiếp tục phiên từ mục: tham chiếu (chỉ định danh và siêu dữ liệu) đi cùng thông điệp sau;
                                   nếu không có phiên, sẽ chọn theo vị trí của mục hoặc tạo mới`,
usage: ['Cách dùng: baocut space rescan | rebuild | trash <entry id> | restore <entry id> | purge <entry id> | delete-video <entry id>', '          baocut space continue <entry id> [--conversation <session id>]'].join('\n'), entryUsage: (action) => `Cách dùng: baocut space ${action} <entry id>`, continueUsage: 'Cách dùng: baocut space continue <entry id> [--conversation <session id>]', flagNotAccepted: (action, key) => `baocut space ${action} không nhận --${key}`, rescanStarted: 'Đã bắt đầu quét lại', rebuilt: (entries, pendingVideos) => `Đã tạo lại danh mục: ${entries} mục; chỉ mục nội dung đang đọc lại ${pendingVideos} video trong nền nên kết quả tìm kiếm chưa đầy đủ đến khi hoàn tất`, purgeBlocked: (id) => `${id} vẫn được video hoặc tác vụ dùng; chưa xóa`, movedToTrash: (id, name) => `Đã chuyển vào Thùng rác: ${id}  ${name}`, restoredFromTrash: (id, name) => `Đã khôi phục từ Thùng rác: ${id}  ${name}`, purged: (id) => `Đã xóa vĩnh viễn ${id}`, notPurged: (id) => `Chưa xóa ${id}: vẫn có tham chiếu`, videoTrashed: (name, entryId, retentionDays) => `Đã chuyển video “${name}” vào Thùng rác: ${entryId} (khôi phục bằng baocut space restore ${entryId}${retentionDays === null ? '' : `; xóa vĩnh viễn sau ${retentionDays} ngày`})`, relatedKept: (n) => `${n} mục xuất hoặc tạo từ video giữ nguyên vị trí`, continued: (created, id, cwd) => `${created ? 'Đã tạo phiên' : 'Đang dùng phiên'} ${id}  thư mục làm việc ${cwd}`, referenceNext: (name, id) => `Tham chiếu đến mục “${name}” sẽ đi cùng thông điệp sau: baocut chat "…" --conversation ${id}`,
};
