import type { ChatMessages } from './chat-copy.ts';

export const vi: ChatMessages = {
help: `Cách dùng:
  baocut chat <message> [options]  Gửi thông điệp và in phản hồi
    --project <dir>                Trò chuyện trong thư mục dự án này (dự án được xác định bằng
                                   .bcut/project.json trong thư mục, sẽ ghi nếu thiếu)
    --conversation <id>            Tiếp tục phiên hiện có
    --template <id>                Đính kèm mẫu cảnh (cảnh từ baocut templates): Runtime nối hướng dẫn
                                   tóm lược và nội dung mẫu vào thông điệp; không thể đính kèm ví dụ;
                                   thay vào đó gửi lời nhắc của ví dụ (baocut templates show <id>) làm thông điệp
    --skill <id>                   Chọn Skill (từ baocut skills, kể cả bị tắt):
                                   Runtime nối nội dung SKILL.md vào thông điệp
    --mode <ask|auto-accept-edits|auto|full-access|plan>
                                   Đổi chế độ truy cập phiên này (hành động sau sẽ theo); bỏ qua thì giữ chế độ
                                   hoặc dùng agent.defaultAccessMode (mặc định auto) nếu chưa từng đổi
    --yes                          Tự phê duyệt yêu cầu (chỉ phiên này)`,
missingMessage: 'Thiếu văn bản thông điệp', templateIsExample: (title, id) => `“${title}” là ví dụ và không thể đính kèm: lấy lời nhắc bằng baocut templates show ${id} rồi gửi làm thông điệp`, sessionCreated: (id, cwd) => `Phiên ${id}  thư mục làm việc ${cwd}`, disconnected: (reason) => `Mất kết nối Runtime: ${reason}`, sessionDeleted: 'Phiên đã bị xóa', stopping: 'Đang dừng…', chatTemplate: (id) => `Mẫu: ${id}`, chatSkill: (id) => `Skill: ${id}`, chatMode: (mode) => `Chế độ truy cập: ${mode}`, taskEnded: (status, error) => `Tác vụ: ${status}${error ? ` · ${error}` : ''}`, taskStatus: { completed: 'Xong', stopped: 'Đã dừng', failed: 'Thất bại' }, taskFailed: 'Tác vụ thất bại', toolCallFinished: (title, status, exitCode) => `▸ ${title} · ${status}${exitCode !== null ? ` (mã thoát ${exitCode})` : ''}`, approvalNeeded: (what) => `Cần phê duyệt · ${what}`, approvalReason: (isTool, reason) => `${isTool ? 'Nội dung' : 'Lý do'}: ${reason}`, approvalMode: (mode) => `Chế độ hiện tại: ${mode}`, autoApproved: 'Đã tự phê duyệt (--yes)', declinedNotTty: 'Không chạy trong terminal: đã từ chối (thêm --yes để tự phê duyệt)', approvalQuestion: 'Phê duyệt? [y] có / [s] phiên / [N] không ',
};
