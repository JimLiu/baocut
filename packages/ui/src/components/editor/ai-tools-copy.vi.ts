import type { AiToolsMessages } from './ai-tools-copy.ts';

export const vi: AiToolsMessages = {
  back: 'Trở lại',
  // 设置态
  who: 'Dùng', whoAgent: 'Giao cho Agent', whoModel: 'Gọi mô hình trực tiếp', whoModelSub: 'Runtime chưa có quy trình này nên chỉ Agent thực hiện được', scope: 'Phạm vi', scopeAll: 'Toàn bộ video', scopeChapter: (index, label) => `Chương ${index} · ${label}`, scopeNoChapters: 'Dòng thời gian chưa có chương nên chỉ có toàn bộ video', byAgent: 'Agent thực hiện', cta: 'Giao cho Agent', queued: 'Agent bận · thông điệp xếp hàng và gửi khi lượt này kết thúc', noConversation: 'Video này không trong dự án hoặc phiên nên không giao cho Agent được.', createFailed: (message) => `Không tạo được phiên: ${message}`,
  // 勾选项与自定义
  prePolish: 'Trau chuốt trước (tự chia đoạn)', prePolishOn: 'Chương nhóm theo đoạn', prePolishOff: 'Bản chép lời chưa trau chuốt chỉ có 1 đoạn nên chương sẽ thô', staleEdited: 'Câu đã sửa trong bản gốc', staleEditedSub: 'Bạn đổi từ trong bản chép lời nhưng bản dịch vẫn cũ', staleCut: 'Câu đã cắt khỏi bản gốc', staleCutSub: 'Đoạn cắt bỏ một phần câu; dịch lại từ bản gốc đã cắt', staleNone: 'Chọn ít nhất một', staleOnly: (language) => `Chỉ bản dịch ${language}`, retranscribeModel: 'Agent chọn mô hình giọng nói đã cài trên máy này; để chọn, nêu trong hướng dẫn dưới.', retranscribeSpeakers: 'Nhận dạng người nói sau chép lời',
  // 写作与发布
  platform: 'Nơi đăng', platformPlaceholder: 'Nền tảng đăng (tùy chọn); theo quy tắc nền tảng và nhắc bạn kiểm tra', titleCount: 'Phương án', titleCountNote: (min, max) => `${min}–${max}, mỗi phương án một góc nhìn`, coverCount: 'Số lượng', coverIdea: 'Điều duy nhất muốn nói', coverIdeaPlaceholder: 'Điều khiến người xem nhấp video (tùy chọn); để trống cho Agent tìm trong bản chép lời', coverRatio: 'Tỷ lệ khung hình', coverRatioProject: 'Giống khung vẽ video', coverText: 'Văn bản bìa',   // 还做不了的
  soon: 'Sắp ra mắt', chaptersPolishFirst: 'Trau chuốt và chia đoạn trước rồi tạo chương',

  session: 'Phiên',
  promptLabel: 'Điều cần nói với Agent',
  promptPlaceholder: 'Làm gì và làm thế nào; dùng @ để nhắc đến chương hoặc người nói',
  restoreDefault: 'Khôi phục mặc định',
  skillNote: 'Cách công cụ này làm việc',
  noSkill: 'Chưa gắn skill: Agent chỉ làm theo lời nhắn ở trên.',
  addSkillBack: 'Gắn lại skill của công cụ này',
  sentNew: 'Đã giao cho Agent · phiên mới',
  sentCurrent: 'Đã giao cho Agent · tiếp tục phiên hiện tại',
  agentCardTitle: 'Việc không có bên dưới, nói với Agent bằng một câu',
  agentCardSomeAgent: 'Agent',
  agentCardOutside: 'Mở phiên chứa video này, lấy video làm ngữ cảnh →',
  noTranscriptTitle: 'Video này chưa có bản chép lời',
  noTranscriptBody: 'Các công cụ ở đây đều bắt đầu từ bản chép lời: trau chuốt, chia chương, tóm tắt, đặt tiêu đề đều cần chép lời trước.',
  goTranscribe: 'Đến bản chép lời',
  stateRunning: 'Đang chạy',
  stateReview: 'Chờ xem',
  agentCardNew: (agent) => `Mở phiên mới với video này làm ngữ cảnh; chạy trong ${agent} trên máy này và hỏi trước khi ghi →`,
  stateChapters: (count) => `${count} chương`,
};
