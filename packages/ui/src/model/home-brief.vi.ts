import type { HomeBriefMessages } from './home-brief.ts';

export const vi: HomeBriefMessages = {
about: (minutes, seconds) => `Khoảng ${[minutes ? `${minutes} phút` : '', seconds ? `${seconds} giây` : ''].filter(Boolean).join(' ')}`, fromMaterials: 'Tạo video từ tư liệu tôi đã đính kèm.', materials: (paths) => `Tư liệu: ${paths.join(', ')}`, connectFirst: 'Kết nối AI trước', sayFirst: 'Nói bạn muốn tạo gì hoặc đính kèm tư liệu', agentOffTitle: 'Mọi Agent lập trình đã cài đều bị tắt', agentOffBody: 'Máy tính này có Agent lập trình đã cài nhưng bị tắt trong Cài đặt. Bật một Agent để bắt đầu ngay tại đây.', enableNamed: (name) => `Bật ${name}`, enableAgent: 'Bật Agent', agentMissingTitle: 'Cần Agent lập trình', agentMissingBody: 'Cài Claude Code hoặc Codex CLI và đăng nhập bằng gói đăng ký của bạn rồi trở lại đây để bắt đầu.', connectAgent: 'Kết nối Agent', nameEmpty: 'Nhập tên dự án', nameInvalid: 'Tên dự án không được chứa dấu gạch chéo hoặc ký tự điều khiển',
};
