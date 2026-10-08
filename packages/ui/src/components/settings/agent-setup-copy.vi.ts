import type { AgentSetupMessages } from './agent-setup-copy.ts';



export const vi: AgentSetupMessages = {
  badge: {
    'not-installed': "Chưa cài",
    error: "Không thể chạy",
    outdated: "Lỗi thời",
    'signed-out': "Cần đăng nhập",
    disabled: "Đã tắt",
  },
  badgeNotChecked: "Chưa kiểm tra",
  badgeReady: "Khả dụng",
  badgeModelUpgrade: "Khả dụng · Mô hình mặc định cần nâng cấp",
  badgeModelUnavailable: "Khả dụng · Mô hình mặc định không khả dụng",
  badgeUpdate: "Khả dụng · Có bản cập nhật",

  errorTitle: (name: string) => `Đã tìm thấy ${name} nhưng không thể chạy`,
  errorBody: (detail: string | null) =>
    `${detail ? `${detail} ` : ""}Thường do Node.js bị gỡ hoặc nâng cấp, hay quyền tệp thay đổi. Chạy kiểm tra có thể xác định bước lỗi.`,
  errorCta: "Chạy kiểm tra",
  outdatedTitle: (name: string, version: string | null) =>
    version ? `${name} ${version} quá cũ để BaoCut điều khiển` : `Phiên bản này của ${name} quá cũ để BaoCut điều khiển`,
  outdatedBody: (detail: string | null, minVersion: string) =>
    `${detail ? `${detail} ` : `Cần ${minVersion} trở lên. `}Nâng cấp chỉ cập nhật công cụ dòng lệnh này; tài khoản và cài đặt riêng của nó vẫn giữ nguyên.`,
  outdatedCta: (version: string) => `Nâng cấp lên ${version}`,
  signedOutTitle: (name: string) => `${name} yêu cầu bạn đăng nhập lại`,
  signedOutBody: (name: string) =>
    `Đăng nhập diễn ra trong cửa sổ riêng của ${name}; BaoCut không xử lý tài khoản hay mật khẩu của bạn. Quay lại đây để kiểm tra sau khi đăng nhập.`,
  signedOutCta: "Mở terminal để đăng nhập",

  stepSkipped: "Kiểm tra khi bước trước thành công",
  stepFind: "Tìm thấy trên máy tính này",
  stepFindFail: (command: string) => `${command} không ở vị trí cài đặt thông thường hoặc trong PATH`,
  stepRun: "Khởi động được",
  stepRunOk: (command: string, version: string) => `${command} --version trả về ${version}`,
  stepRunFail: "Khởi động thất bại",
  stepVersion: "Phiên bản được BaoCut hỗ trợ",
  stepVersionOk: (version: string, min: string) => `${version}, tối thiểu ${min}`,
  stepVersionFail: (version: string, min: string) => `Hiện tại ${version}, tối thiểu ${min}`,
  stepLogin: "Đã đăng nhập tài khoản của bạn",
  stepLoginOk: "Đã đăng nhập",
  stepLoginFail: "Agent báo chưa đăng nhập hoặc đăng nhập đã hết hạn",
  stepModels: "Có danh sách mô hình",
  stepModelsOk: (n: number) => `${n} mô hình`,
  stepModelsNone: "Agent không báo danh sách mô hình; phiên dùng mô hình mặc định của Agent",
  verdictFail: (label: string, detail: string) => `Vướng ở “${label}”: ${detail}`,
  verdictOk: "Cả năm kiểm tra đều thành công. Bạn có thể bắt đầu phiên.",

  moreSummary: (names: string[], more: boolean) => names.join(", ") + (more ? " và nhiều nữa" : ""),

  readyTitle: "Sẵn sàng",
  readyBody: (name: string, model: string, plan: string) =>
    `Phiên mới dùng ${name} · ${model}. Chạy trên ${name} đã cài trên máy tính này với ${plan} của bạn; BaoCut không thu thêm phí.`,
  readyCta: "Bắt đầu phiên",
  attentionBody: (name: string) =>
    `Đã cài trên máy tính này nên không cần cài lại. Nguyên nhân và cách sửa ở hàng “${name}” bên dưới.`,
  attentionCta: "Xem vấn đề",
  offTitle: (name: string) => `${name} đã cài nhưng đang tắt`,
  offBody: "Bật để giao việc từ BaoCut bằng một câu.",
  offCta: (name: string) => `Bật ${name}`,
  missingTitle: "Chưa phát hiện Agent trên máy tính này",
  missingBodyMany: "Cài một Agent bên dưới và đăng nhập bằng tài khoản bạn đã có. Không cần cài tất cả.",
  missingBodyOne: "Cài theo các bước bên dưới và đăng nhập bằng tài khoản bạn đã có.",

  logDropped: (n: number) => `… (đã lược bỏ ${n} dòng trước)`,
  doneNotDetected: (name: string) => `Lệnh đã hoàn tất nhưng ${name} vẫn chưa được phát hiện. Nếu cài ở nơi khác, bạn có thể đặt vị trí thủ công.`,
  doneSignIn: (name: string, version: string) => `Đã phát hiện ${name} ${version} · Đăng nhập một lần để hoàn tất`,
  doneInstalled: (name: string, version: string) => `Đã phát hiện ${name} ${version}`,
  doneUpgraded: (name: string, version: string) => `${name} hiện ${version} · Đang làm mới danh sách mô hình`,

  tier: {
    balanced: { label: "Đề xuất", description: "Đủ để chép lời, dịch và chỉnh sửa; nhanh và dùng ít hạn mức gói đăng ký hơn" },
    max: { label: "Mạnh nhất", description: "Chậm hơn và dùng nhiều hạn mức gói đăng ký; hiếm khi cần" },
    fast: { label: "Nhanh nhất", description: "Phù hợp chỉnh sửa nhỏ như thay vài phụ đề" },
  },
  agentDefaultModel: "Mô hình mặc định của Agent",
  cliConfigGate: (model: string) => `Theo cài đặt CLI · ${model} cần nâng cấp CLI`,
  cliConfigModel: (model: string) => `Theo cài đặt CLI · ${model}`,
  cliConfig: "Theo cài đặt CLI",
  modelMissing: "Không có trong danh sách mô hình hiện tại; phiên mới dùng mô hình đề xuất",
  effort: {
    minimal: "Tối thiểu",
    low: "Thấp",
    medium: "Trung bình",
    high: "Cao",
    xhigh: "Rất cao",
    max: "Tối đa",
  } as Record<string, string>,
  modelDefaultEffort: "Mặc định của mô hình",
  modelDefaultEffortOf: (label: string) => `Mặc định của mô hình (${label})`,

  rulesTitle: (n: number) => `Lệnh luôn được phép · ${n}`,
  rulesBody:
    "Những quy tắc này đến từ lựa chọn “Luôn cho phép” trong phiên. Khi xóa, quy tắc không còn tự phê duyệt hành động; chế độ truy cập và quy tắc khác vẫn áp dụng.",
  rulesEmpty: "Chưa có quy tắc đã lưu. Chọn “Luôn cho phép” trên thẻ phê duyệt trong phiên để xuất hiện tại đây.",
};
