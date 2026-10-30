import type { RcSchedulesMessages } from './rc-schedules.ts';

export const vi: RcSchedulesMessages = {
  notFound: (p) => `Không tìm thấy tác vụ theo lịch: ${p.id}`,
  conversationNotFound: (p) => `Không tìm thấy phiên: ${p.id}`,
  conversationArchived: 'Phiên này đã được lưu trữ. Hãy khôi phục nó từ Phiên đã lưu trữ trước khi đặt lịch.',
  noProject: 'Phiên này không thuộc dự án nào nên không thể mỗi lần mở một phiên mới trong dự án.',
  invalid: 'Hãy kiểm tra tác vụ theo lịch: nội dung gửi, tần suất và giới hạn số lần chạy phải hợp lệ.',
  notActive: 'Chỉ tác vụ theo lịch đang bật mới chạy ngay được.',
  resumeArchived: 'Phiên đích đã được lưu trữ. Hãy khôi phục nó từ Phiên đã lưu trữ, hoặc sửa tác vụ để mỗi lần mở một phiên mới.',
  resumeDeleted: 'Phiên đích đã bị xóa. Hãy sửa tác vụ để mỗi lần mở một phiên mới.',
  resumeProjectRemoved: 'Dự án đã bị gỡ khỏi BaoCut nên không thể mở phiên mới trong đó.',
  resumeCompleted: 'Đã chạy đủ số lần tối đa. Hãy tăng giới hạn trước khi tiếp tục.',
  runStopped: 'Đã dừng trước khi xong',
};
