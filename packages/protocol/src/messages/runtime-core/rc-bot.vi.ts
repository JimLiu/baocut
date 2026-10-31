import type { RcBotMessages } from './rc-bot.ts';

export const vi: RcBotMessages = {
  // ---- 频道 ----
  mainChannelName: 'Kênh chính',
  channelNotFound: (p: { id: string }) => `Không tìm thấy kênh: ${p.id}`,
  mainChannelLocked: 'Không thể lưu trữ hoặc xóa kênh chính.',
  channelArchived: 'Kênh này đã được lưu trữ. Khôi phục để tiếp tục làm việc ở đây.',
  channelDeleteCountsChanged: 'Số việc hoặc việc theo lịch trong kênh này đã thay đổi. Hãy kiểm tra lại trước khi xóa.',
  memoryVersionConflict: 'Bộ nhớ đã thay đổi từ lúc bạn mở. Hãy xem phiên bản mới nhất rồi thử lại.',
  memoryTooLarge: (p: { max: number }) => `Bộ nhớ tối đa ${p.max} KB. Hãy dọn bớt trước khi thêm.`,
  memorySensitive: 'Đừng đưa khóa, mật khẩu, số giấy tờ tùy thân hay số thẻ vào bộ nhớ.',
  accessAboveChannelMax: 'Chế độ truy cập của việc không thể cao hơn giới hạn của kênh.',

  // ---- 任务 ----
  workItemNotFound: (p: { id: string }) => `Không tìm thấy việc: ${p.id}`,
  transitionDenied: (p: { from: string; event: string }) => `Việc này không thể thực hiện "${p.event}" khi đang ở trạng thái ${p.from}.`,
  textHasLinkOrNumber: 'Nội dung việc không nên chứa liên kết, địa chỉ email hay dãy số dài. Hãy đưa chúng vào phần tài nguyên.',
  titleByUser: 'Bạn đã viết tiêu đề này nên agent không thể thay đổi.',
  userTasksNoThread: 'Việc của riêng bạn không mở luồng.',
  stoppedByYou: 'Bạn đã dừng việc này.',
  continueOrStop: 'Tiếp tục hay dừng?',
  optionContinue: 'Tiếp tục',
  optionStop: 'Dừng',
  stalledNoProgress: (p: { minutes: number }) => `Đã ${p.minutes} phút không có tiến triển.`,
  stalledJobHung: (p: { job: string }) => `${p.job} im lặng lâu hơn dự kiến rất nhiều.`,
  stalledBudget: 'Việc này đã dùng 80% ngân sách.',
  interruptedOnExit: 'Bị gián đoạn khi BaoCut thoát lần trước.',
  threadLost: 'Không còn thấy luồng của việc này.',
  needsYouToRun: (p: { agent: string }) => `Bước này cần bạn có mặt: ${p.agent} không thể xin phê duyệt từng bước. Tiếp tục ngay bây giờ?`,
  approvalWaiting: (p: { summary: string }) => `Đang chờ bạn phê duyệt: ${p.summary}`,
  youAnswered: (p: { text: string }) => `Bạn đã trả lời: ${p.text}`,
  youConfirmedDone: 'Bạn đã xác nhận là xong.',
  youReopened: 'Bạn đã mở lại việc này.',
  previousQuestion: (p: { text: string }) => `Câu hỏi trước: ${p.text}`,
  implicitReopenNote: (p: { what: string }) => `Luồng đã thay đổi ${p.what} sau khi việc được giải quyết.`,
  movedFrom: (p: { channel: string }) => `Đã chuyển từ ${p.channel}.`,
  queued: (p: { position: number }) => `Đang chờ chỗ trống (thứ ${p.position}).`,
  revertUserEdits: (p: { video: string; version: number }) =>
    `Bạn đã chỉnh sửa ${p.video} ở phiên bản ${p.version}, nên không thể chỉ hoàn tác các thay đổi của agent.`,
  revertMixedVersion: (p: { video: string; version: number }) =>
    `Phiên bản ${p.version} của ${p.video} có cả chỉnh sửa của bạn lẫn của agent, nên không thể chỉ hoàn tác các thay đổi của agent.`,

  // ---- 频道对话里 Runtime 写的 ----
  fallbackRelay: (p: { title: string; headline: string }) => `${p.title}: ${p.headline}`,
  reminder: (p: { title: string }) => `Nhắc nhở: ${p.title}`,
  reminderOverdue: (p: { title: string; date: string }) => `${p.title} đến hạn vào ${p.date} nhưng vẫn chưa xong.`,
  reminderStale: (p: { title: string; days: number }) => `${p.title} đã chờ bạn ${p.days} ngày.`,
  welcome:
    'Chào bạn, mình là trợ lý của bạn ở đây. Hãy cho mình biết bạn muốn làm gì với video, mình sẽ lo, và sẽ báo bạn khi có việc cần bạn.',
  welcomeWithProjects: (p: { projects: number; videos: number }) =>
    `Chào bạn, mình là trợ lý của bạn ở đây. Mình thấy ${p.projects} dự án với ${p.videos} video. Hãy cho mình biết bạn muốn làm gì, mình sẽ lo.`,
  starterSummarize: 'Tóm tắt video',
  starterSummarizeText: 'Tóm tắt giúp mình video mới nhất',
  starterCaptions: 'Thêm phụ đề',
  starterCaptionsText: 'Thêm phụ đề cho video mới nhất của mình',
  starterHighlights: 'Tìm đoạn nổi bật',
  starterHighlightsText: 'Tìm những khoảnh khắc hay nhất trong video mới nhất của mình',
  markDone: 'Đánh dấu là xong',
  handoffDriver: (p: { agent: string }) => `Tiếp tục với ${p.agent}.`,
  editedMessage: 'Bạn đã sửa tin nhắn này.',
  reactionYes: 'Có',
  reactionNo: 'Không',
  approvalNeedsYou: 'Có một yêu cầu phê duyệt đang chờ bạn.',
  makeNoGenerator: 'Chưa thiết lập mô hình văn bản nên chưa có gợi ý.',
  scheduleNotReady: 'Hiện không dùng được việc theo lịch.',
  proposalChannelExists: 'Đã có kênh trùng tên này.',
  dependencyWaiting: (p: { title: string }) => `Đang chờ "${p.title}".`,
  lateStart: (p: { minutes: number }) => `Bắt đầu trễ ${p.minutes} phút.`,

  // ---- 通知 ----
  notifyNeedsReview: (p: { title: string }) => `${p.title} đã sẵn sàng để bạn xem lại`,
  notifyNeedsInput: (p: { title: string }) => `${p.title} cần bạn trả lời`,
  notifyStalled: (p: { title: string }) => `${p.title} đang bị kẹt`,
  notifyReminder: (p: { title: string }) => `Nhắc nhở: ${p.title}`,

  // ---- 提议 ----
  proposalNotFound: 'Thẻ này không còn nữa.',
  proposalHandled: 'Thẻ này đã được xử lý.',
  chipStale: 'Các gợi ý này đã cũ.',
  userOnly: 'Chỉ người dùng mới làm được việc này.',
  notReady: 'Chế độ Bot chưa sẵn sàng.',
  automationPaused: 'Tự động hóa đang tạm dừng.',
};
