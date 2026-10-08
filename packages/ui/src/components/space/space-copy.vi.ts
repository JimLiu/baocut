import type { SpaceMessages } from './space-copy.ts';
import { revealLabel } from '../../copy.ts';

export const vi: SpaceMessages = {
 searchPlaceholder: 'Tìm tên, tệp hoặc lời nói trong video', searchLabel: 'Tìm trong Space',

  // 列表与菜单
  openVideo: 'Mở video',
  viewInfo: 'Xem thông tin',
  transcribe: { first: 'Chép lời…', redo: 'Chép lời lại…', retry: 'Thử chép lời lại…' },
  info: 'Chi tiết video…',
  view: 'Xem',
  continue: 'Tiếp tục trong phiên',
  favorite: 'Yêu thích',
  unfavorite: 'Bỏ yêu thích',
  rename: 'Đổi tên',
  get reveal() {
    return revealLabel();
  },
  viewTask: 'Xem tác vụ',
  trash: 'Chuyển vào Thùng rác',
  restore: 'Khôi phục từ Thùng rác',
  purge: 'Xóa vĩnh viễn',
  clear: 'Xóa',
  columnMeasure: 'Thời lượng hoặc kích thước',
  columnStatus: 'Trạng thái',
  noValue: '—',
  favorited: 'Đã yêu thích',

  // 工具条
  statusPicker: 'Trạng thái', refreshMenu: 'Làm mới', rescan: 'Quét lại thư mục dự án', rescanHint: 'Đọc lại tệp trong mọi thư mục dự án và phiên', rebuild: 'Xây dựng lại chỉ mục', rebuildHint: 'Loại bỏ và xây dựng lại danh mục dẫn xuất và chỉ mục nội dung; giữ lại yêu thích, tên hiển thị và Thùng rác', scanning: 'Đang quét thư mục dự án', rebuilt: (entries, pending) => pending > 0 ? `Đã xây dựng lại chỉ mục · ${entries} mục · chỉ mục nội dung cho ${pending} video vẫn đang cập nhật ở nền` : `Đã xây dựng lại chỉ mục · ${entries} mục`,

  // 新建
  newLabel: 'Mới', newBlank: 'Video trống mới', newBlankHint: 'Video trống 16:9 mở ngay, không chép lời hay xếp hàng', newFromFile: 'Video mới từ tệp', newFromFileHint: 'Video hoặc âm thanh đưa vào ô soạn tin ở Home để bạn nói cần làm gì; hình ảnh vào thẳng dòng thời gian', newFromPackage: 'Video mới từ gói di động', newFromPackageHint: 'Tệp .baocut xuất ở nơi khác, chứa đầy đủ tư liệu', pickPackageTitle: 'Chọn gói di động', pickPackageButton: 'Mở', pickPackageFilter: 'Gói di động BaoCut', openPackage: 'Mở thành video mới', packageBlocked: (reason) => `Mở thành video mới: ${reason}`, packageOpening: (name) => `Đang mở “${name}”…`, packageOpened: (name) => `Đã mở “${name}” thành video mới`, importAssets: 'Nhập tư liệu', importAssetsHint: 'Đăng ký tệp làm tư liệu dự án; tệp ngoài dự án được sao chép vào imports/ của dự án', whichProject: 'Dự án nào', noProject: 'Mở thư mục dự án trong Home trước', pickNotMedia: 'Đây không phải tệp video, âm thanh hoặc hình ảnh', createdFromFile: (name) => `Đã tạo video “${name}” và đặt tư liệu`, createdEmpty: (reason) => `Đã tạo video nhưng chưa đặt tư liệu: ${reason}`,

  // 导入框（原型 SpaceImport）
  importTitle: 'Nhập tư liệu', importProject: 'Nhập vào dự án', importHint: 'Chọn video, âm thanh hoặc hình ảnh. Tệp trong thư mục dự án được đăng ký tại chỗ; tệp bên ngoài được sao chép vào imports/ của dự án, còn tệp gốc giữ nguyên. Không thêm gì vào video nào.', importPick: 'Chọn tệp…', importNoProject: 'Chưa có dự án: mở thư mục dự án trong Home trước.', importing: 'Đang nhập',

  // 查看框
  factSource: 'Nguồn', factFile: 'Tệp', factMeasure: 'Thời lượng hoặc kích thước', factSize: 'Kích thước', factStatus: 'Trạng thái', factActivity: 'Hoạt động gần nhất', factConversation: 'Phiên nguồn', factGenerated: 'Được tạo', factVersion: 'Phiên bản', factNote: 'Ghi chú', viewConversation: 'Xem phiên nguồn', close: 'Đóng', editBlocked: (reason) => `Chỉnh sửa lại: ${reason}`, continueBlocked: (reason) => `Tiếp tục trong phiên: ${reason}`, version: (frozen, current) => current && current !== frozen ? `Phiên bản video ${frozen}; video hiện là ${current}` : `Phiên bản video ${frozen}`, missingTitle: 'Không tìm thấy tệp này',
  // 卡片角标与列表缩略图的读屏说明（原型 sp-prev__flag）
  missingFile: 'Không tìm thấy tệp', missingBody: 'Mục vẫn ở đây. Trạng thái sẽ khôi phục khi tệp trở lại.', failedTitle: 'Tạo thất bại', failedBody: 'Không tạo được tệp. Xem nguyên nhân và thử lại ở trang Tác vụ, hoặc xóa nếu không cần.', changedTitle: 'Video nguồn đã thay đổi', changedBody: 'Kết quả này khớp với phiên bản trước của video. Vẫn dùng được nhưng không còn phản ánh video hiện tại.', reexport: 'Xuất lại từ video nguồn', noPreviewVideo: 'Video mở trong trình chỉnh sửa.',

  // 能力（origin.capability）
  capability: { synthesizeSpeech: 'Lồng tiếng', generateImage: 'Tạo hình ảnh', generateText: 'Tạo văn bản', export: 'Xuất' },

  // 动作的结果
  trashed: (name) => `Đã chuyển vào Thùng rác · ${name}`, undo: 'Hoàn tác', restored: (name) => `Đã khôi phục · ${name}`, purged: (name) => `Đã xóa vĩnh viễn · ${name}`, cleared: (name) => `Đã xóa · ${name}`, renamed: 'Đã đổi tên', continued: (created, name, title) => created ? `Đã bắt đầu phiên mới với “${name}” đính kèm: viết yêu cầu rồi gửi` : `Đã trở lại “${title}” với “${name}” đính kèm: viết yêu cầu rồi gửi`, sourceGone: 'Video nguồn hiện không ở thư mục dự án hoặc phiên nào nên không thể mở', failed: (what, reason) => `${what} thất bại: ${reason}`,

  // 删除视频（产品设计 §4.9）
  trashVideoTitle: 'Xóa video này?', trashVideoBody: 'Toàn bộ thư mục video chuyển vào Thùng rác của dự án và có thể khôi phục. Tư liệu gốc được liên kết giữ nguyên vị trí.', trashVideoRelated: (n) => `${n} mục được xuất hoặc tạo từ video vẫn ở Space và không bị xóa cùng video:`, trashVideoConfirm: 'Xóa video',
  // 彻底删除
  purgeTitle: 'Xóa vĩnh viễn?', purgeBody: (name) => `“${name}” sẽ bị xóa khỏi ổ đĩa và không thể khôi phục. Nếu video hoặc tác vụ đang chạy còn dùng, không có gì bị xóa và bạn sẽ thấy thứ đang dùng nó.`, purgeVideoBody: (name) => `Toàn bộ thư mục video “${name}” sẽ bị xóa khỏi ổ đĩa và không thể khôi phục. Tư liệu gốc được liên kết không bị ảnh hưởng.`, purgeConfirm: 'Xóa vĩnh viễn', blockedTitle: 'Chưa thể xóa', blockedBody: (name) => `“${name}” vẫn đang được dùng nên chưa xóa gì:`, gotIt: 'Đã hiểu',

  // 改名
  renameTitle: 'Đổi tên', renameLabel: 'Tên hiển thị', renameHint: (fileName) => `Chỉ đổi tên hiển thị trong Space; tệp không đổi. Để trống để trở lại “${fileName}”.`, save: 'Lưu',
  // 来源视频改过（产品设计 §4.6）
  changedDialogTitle: 'Video nguồn đã thay đổi', changedDialogBody: (frozen, current) => `Kết quả này khớp với phiên bản video ${frozen ?? '(không rõ)'}; video hiện là ${current ?? '(không rõ)'}. Bản làm việc hiện tại sẽ mở.`, changedOpenCurrent: 'Mở bản làm việc hiện tại', changedFromFrozen: 'Tiếp tục từ phiên bản đó', changedFromFrozenReason: 'Chưa thể tiếp tục từ phiên bản dùng để tạo bản xuất này (Runtime chưa có lệnh quay về một phiên bản). Bạn có thể mở bản làm việc hiện tại và xem phiên bản đó trong Lịch sử.',

  // 内容命中（架构设计 §5.11）
  hitsTitle: 'Lời nói trong video', hitsCount: (n) => `${n} kết quả khớp`, hitsSearching: 'Đang tìm chỉ mục nội dung', hitsNone: 'Không có lời nói trong video khớp', hitsError: (reason) => `Không thể tìm chỉ mục nội dung: ${reason}`, hitUnopenable: 'Video này hiện không ở thư mục dự án hoặc phiên nào, hoặc đang trong Thùng rác, nên không thể mở', hitSourceClock: 'Nội dung nằm trong tư liệu, không trên dòng thời gian: hãy mở video và tìm', hitStale: 'Video đã đổi sau khi lập chỉ mục nên vị trí có thể lệch',
  // 内容命中的过滤与分组（设计稿 page-projects.jsx HitGroup；种类、说话人是合同 space.search 的筛选）
  hitsGrouped: (n, videos) => `${n} kết quả khớp · ${videos} video`, hitKind: 'Loại tài liệu', hitKindAll: 'Mọi loại', hitSpeaker: 'Người nói', hitSpeakerAll: 'Mọi người nói', hitSpeakerNone: 'Không có người nói trong kết quả khớp này', hitsNoneFiltered: 'Không có kết quả khớp loại hoặc người nói này. Hãy thử loại hoặc người khác.', hitsMore: (n) => `Hiện thêm ${n}`,

  // 页面里的其余文字
  cancel: 'Hủy', openForEdit: 'Mở để chỉnh sửa', newVideo: 'Video mới', revealUnavailable: 'Tệp này không ở thư mục dự án hoặc phiên nào nên không có vị trí để hiện', sidebarLabel: 'Danh mục Space', kindsHeader: 'Danh mục', mineHeader: 'Sắp xếp', sidebarNote: 'Space hiện video, tư liệu và đầu ra trong mọi dự án của bạn. Tệp vẫn ở thư mục dự án riêng.', all: 'Tất cả', emptyFiltered: 'Không có mục khớp', emptyTrash: 'Thùng rác trống', emptyFavorite: 'Chưa có mục yêu thích', emptyAll: 'Chưa có mục', emptyCategory: (label) => `Chưa có gì trong ${label}`, emptyFilteredBody: 'Thử bỏ bộ lọc dự án và trạng thái.', emptyTrashBody: 'Mục chuyển vào Thùng rác xuất hiện ở đây. Bạn có thể khôi phục hoặc xóa vĩnh viễn.', emptyBody: 'Yêu cầu Agent trong phiên và đầu ra sẽ xuất hiện ở đây. Bạn cũng có thể nhập tư liệu từ “Mới” hoặc mở thư mục có sẵn trong Home.', projectPicker: 'Dự án', allProjects: 'Mọi dự án', sortPicker: 'Sắp xếp', viewPicker: 'Chế độ xem', viewGrid: 'Lưới', viewList: 'Danh sách', issuesTitle: (n) => `${n} thư mục chưa được liệt kê đầy đủ`, issueTruncated: (detail) => `Quá nhiều tệp, chỉ liệt kê một phần: ${detail}`, issueUnreadable: (detail) => `Không thể đọc: ${detail}`, preparing: 'Đang chuẩn bị Space…', preparingBody: 'Lần đầu cần quét thư mục dự án. Sẽ mất một chút thời gian.', createIn: (project, hint) => `Trong “${project}” · ${hint}`, whichProjectFor: (label) => `${label}: dự án nào`, entryActions: (name) => `Thao tác với “${name}”`, entriesLabel: 'Mục Space', columnName: 'Tên', columnKind: 'Loại', columnSource: 'Nguồn', columnActivity: 'Hoạt động gần nhất', columnMenu: 'Thao tác', relatedMore: (n) => `…${n} mục tổng cộng`, importSummaryIn: (text, project) => `${text} (${project})`, activityAt: (ago, at) => `${ago} (${at})`, withReason: (reason, body) => `${reason}. ${body}`,
};
