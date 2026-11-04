import type { DriversCodexMessages } from './drivers-codex.ts';

export const vi: DriversCodexMessages = {
plan: 'Gói đăng ký ChatGPT Plus hoặc Pro', installHint: 'Cài Codex CLI', signedOut: (p) => `Codex chưa đăng nhập. Chạy codex login trong terminal.${p.detail ? ` (${p.detail})` : ''}`, loginCheckFailed: (p) => `Không kiểm tra được trạng thái đăng nhập Codex: ${p.command} login status bị lỗi. BaoCut chạy chương trình này với các lệnh con như login status và app-server, nên script bọc phải chuyển nguyên các đối số.${p.detail ? ` (${p.detail})` : ''}`,
  customProvider: 'Nhà cung cấp mô hình tùy chỉnh',
  chatgptAccount: 'Tài khoản ChatGPT', apiKey: 'Khóa API OpenAI', accessToken: 'Token truy cập', workloadIdentity: 'Danh tính khối lượng công việc', codexAccount: 'Tài khoản Codex', steerMismatch: (p) => `Codex phản hồi turn/steer không đúng: cần lượt ${p.expected}, nhận được ${p.received}`, appServerExited: (p) => `codex app-server đã thoát (code ${p.code}, signal ${p.signal})${p.stderr ? `\n${p.stderr}` : ''}`, connectionClosed: 'Kết nối codex app-server đã đóng', requestTimeout: (p) => `Yêu cầu codex app-server hết thời gian chờ: ${p.method}`, appServerGone: 'codex app-server đã thoát',
};
