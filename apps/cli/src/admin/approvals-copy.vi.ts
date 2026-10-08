import type { ApprovalsMessages } from './approvals-copy.ts';

export const vi: ApprovalsMessages = {
help: `Cách dùng:
  baocut approvals                 Liệt kê phê duyệt đang chờ từ phiên và dịch vụ bên ngoài
  baocut approvals allow <id>      Cho phép phê duyệt đang chờ; phê duyệt chia sẻ dữ liệu mặc định
                                   chỉ cho phép một lần (chưa rõ số tiền)
    --persist                      Cấp thêm ủy quyền thường trực (cùng chia sẻ dữ liệu sẽ không hỏi lại)
    --scope <video|all>            Phạm vi ủy quyền thường trực: video của lệnh gọi này (mặc định) hoặc mọi video
    --max-calls <n>                Giới hạn lệnh gọi của ủy quyền thường trực
    --budget <amount> --currency <currency>
                                   Giới hạn chi tiêu của ủy quyền thường trực (chỉ mô hình có giá;
                                   lệnh gọi không ước tính được chi phí cần phê duyệt mỗi lần)
    --expires <ISO time>           Thời điểm ủy quyền thường trực hết hạn
  baocut approvals deny <id>       Từ chối phê duyệt đang chờ`,
persistNeedsAllow: '--persist chỉ dùng cùng allow', alreadyResolved: (id) => `Phê duyệt ${id} đã được xử lý, hết hạn hoặc hủy (hoặc không tồn tại)`, allowed: (id) => `Đã cho phép ${id}`, denied: (id) => `Đã từ chối ${id}`, unknownMode: (value, flags) => `Chế độ truy cập không xác định: ${value}. --mode nhận ${flags.join(', ')}`, mode: (label, flag) => `${label} (${flag})`, usage: 'Cách dùng: baocut approvals [list | allow <approval id> | deny <approval id>]', riskLabels: { read: 'Đọc', edit: 'Chỉnh sửa', command: 'Lệnh', high: 'Rủi ro cao' }, none: 'Không có phê duyệt đang chờ', fromSession: (title) => `Phiên “${title}”`, fromService: (serviceId, clientName) => `Dịch vụ ${serviceId} · ${clientName}`, basisMode: (mode) => `chế độ ${mode}`, basisLevel: (level) => `mức ${level}`, approvalLine: (a) => `${a.id}  ${a.who}  ${a.action}${a.targets.length > 0 ? ` → ${a.targets.join(', ')}` : ''}  [${a.risk}] ${a.summary} (${a.basis}${a.secondsLeft === null ? '' : `, tự từ chối sau ${a.secondsLeft} giây`})`, runCommand: (command) => `Chạy lệnh: ${command}`, changeFiles: (files) => `Đổi tệp: ${files.join(', ')}`, callTool: (tool, files) => `Gọi ${tool}${files.length > 0 ? `: ${files.join(', ')}` : ''}`,
};
