import type { EditorMessages } from './editor-copy.ts';

export const vi: EditorMessages = {
withNote: (label, note) => `${label} (${note})`, labeled: (label, value) => `${label}: ${value}`, thenNext: (message, next) => `${message}. ${next}`, gap: ' ', undo: 'Hoàn tác', redo: 'Làm lại', cancel: 'Hủy', retry: 'Thử lại', addClip: 'Thêm clip', editor: 'Trình chỉnh sửa', notEditableNow: 'Hiện không chỉnh sửa được video', timeline: 'Dòng thời gian', moveClips: 'Chuyển clip', moveTrack: 'Chuyển rãnh', importAndAdd: 'Nhập và thêm tư liệu', seconds2: (seconds) => `${seconds.toFixed(2).replace('.', ',')} giây`, emptyTimeline: 'Kéo tư liệu vào đây hoặc thêm từ bảng bên phải', hideTrack: (label) => `Ẩn ${label}: không hiện trong xem trước`, showTrack: (label) => `Hiện ${label}`, hideTrackLabel: 'Ẩn rãnh', showTrackLabel: 'Hiện rãnh', unmuteTrack: (label) => `Bật tiếng ${label}`, muteTrack: (label) => `Tắt tiếng ${label}`, unmuteTrackLabel: 'Bật tiếng', muteTrackLabel: 'Tắt tiếng rãnh', unlockTrack: (label) => `Mở khóa ${label}`, lockTrack: (label) => `Khóa ${label}: clip trên rãnh không chuyển, cắt tỉa hoặc xóa được`, unlockTrackLabel: 'Mở khóa rãnh', lockTrackLabel: 'Khóa rãnh', playTip: { play: 'Phát · Space', pause: 'Tạm dừng · Space', replay: 'Phát lại' }, playLabel: { play: 'Phát', pause: 'Tạm dừng', replay: 'Phát lại' }, undoTip: (label, keys) => `Hoàn tác “${label}” ${keys}`, redoTip: (label, keys) => `Làm lại “${label}” ${keys}`, nothingToUndo: 'Không có gì để hoàn tác', nothingToRedo: 'Không có gì để làm lại', splitTip: 'Tách tại đầu phát · S', split: 'Tách', splitClips: 'Tách clip', deleteTip: 'Xóa vùng chọn · Delete', deleteSelected: 'Xóa vùng chọn', playhead: 'Vị trí đầu phát', totalLength: (duration) => `Tổng thời lượng ${duration}`, editFailed: (message) => `Không chỉnh sửa được: ${message}`, cantOpen: 'Không mở được video này', openingAria: 'Đang mở video', opening: 'Đang mở video…', resizeTimeline: 'Đổi kích thước dòng thời gian', workingDraft: 'Bản nháp làm việc', previewCanvas: 'Xem trước', previewFailed: 'Không vẽ được xem trước', emptyDrag: 'Kéo tư liệu lên dòng thời gian', emptyOr: 'hoặc thêm từ bảng tư liệu bên phải', problemsCount: (n) => `${n} mục không vẽ được`, problemsTitle: 'Một số nội dung trong khung hình không vẽ được', rendererFailed: (message) => `Trình kết xuất xem trước chưa tải: ${message}`, spectrumTooLarge: (itemId, assetId, mb) => `Dạng sóng ${itemId}: tư liệu ${assetId} quá ${mb} MB nên xem trước không phân tích âm thanh; không ảnh hưởng xuất`,
  stall: {
    loading: 'Đang tải xem trước',
    title: 'Xem trước bị kẹt',
    engine: 'Bộ máy xem trước vẫn đang tải',
    video: 'Vẫn đang chuẩn bị video này',
    media: (name: string) => `Đang chờ phương tiện: ${name}`,
    mediaUnnamed: 'Đang chờ phương tiện',
    preparing: 'Đang chuẩn bị xem trước',
    converting: (name: string) => `Đang chuyển đổi để phát được: ${name}`,
    convertingUnnamed: 'Đang chuyển đổi phương tiện để phát được',
    once: 'Việc này chỉ diễn ra lần đầu mở. Tệp gốc của bạn không bị thay đổi.',
    prepare: (name: string) => `Chuyển đổi phương tiện không tiến triển: ${name}`,
    prepareUnnamed: 'Chuyển đổi phương tiện không tiến triển',
    captions: (name: string) => `Đang chờ phụ đề: ${name}`,
    captionsUnnamed: 'Đang chờ phụ đề',
    fonts: (name: string) => `Đang chờ phông chữ: ${name}`,
    paint: 'Hình ảnh đã ngừng cập nhật',
    body: (seconds: number) => `Đã chờ ${seconds} giây. Thử lại chỉ tải lại xem trước; video của bạn không bị thay đổi.`,
  },
};
