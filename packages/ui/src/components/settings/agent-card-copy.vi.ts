import { createElement, Fragment, type ReactNode } from 'react';
import type { AgentCardMessages } from './agent-card-copy.ts';



export const vi: AgentCardMessages = {
  runFailed: (message: string) => `Không chạy được: ${message}`,
  stopFailed: (message: string) => `Không dừng được: ${message}`,
  /** 复制按钮与「已复制」提示里的那个名词。 */
  loginCommand: "lệnh đăng nhập",
  installCommand: "lệnh cài đặt",
  upgradeCommand: "lệnh nâng cấp",
  linkLabel: "liên kết",
  terminalLogin: (command: string) => `Đang chạy ${command} trong terminal · Quay lại đây sau khi đăng nhập`,
  terminalRun: (command: string) => `Đang chạy ${command} trong terminal · Quay lại đây khi hoàn tất`,
  terminalCopied: (label: string) => `Không mở terminal được. Đã sao chép ${label}; dán vào terminal để chạy.`,
  terminalManual: (command: string) => `Không mở terminal được. Chạy ${command} trong terminal.`,
  terminalFailed: (message: string) => `Không mở terminal được: ${message}`,
  enableFailed: (message: string) => `Không bật được: ${message}`,
  disableFailed: (message: string) => `Không tắt được: ${message}`,
  recheckFailed: (message: string) => `Không kiểm tra lại được: ${message}`,
  saveModelFailed: (message: string) => `Không lưu mô hình mặc định được: ${message}`,
  saveEffortFailed: (message: string) => `Không lưu mức suy luận mặc định được: ${message}`,
  refreshFailed: (message: string) => `Không làm mới mô hình được: ${message}`,
  setDefaultFailed: (message: string) => `Không đặt làm mặc định được: ${message}`,
  openFailed: (message: string) => `Không mở được: ${message}`,
  enabled: (name: string) => `Đã bật ${name}`,
  disabled: (name: string) => `Đã tắt ${name} · Phiên mới không còn liệt kê Agent này`,

  defaultBadge: "Mặc định",
  subInstalled: (version: string | null, account: string | null) =>
    ["Đã cài trên máy tính này", version ? `v${version}` : null, account].filter(Boolean).join(" · "),
  subMissing: (command: string, plan: string) => `${command} không có trên máy tính này · Chỉ cần ${plan} mà bạn đã có`,
  enable: (name: string) => `Bật ${name}`,
  details: "Chi tiết",
  install: "Cài",
  checking: "Đang kiểm tra…",
  gateTitle: (name: string, model: string) => `${name} có mô hình mặc định ${model} cần phiên bản mới hơn`,
  gateBody: (version: string, model: string) =>
    `Máy tính này có ${version}, và danh sách mô hình của phiên bản này không có ${model}. Phiên đặt “Mô hình mặc định của Agent” dùng mô hình đã cấu hình và bị từ chối khi gửi; phiên dùng mô hình cụ thể không bị ảnh hưởng.`,
  gateUpgrade: "Nâng cấp chỉ cập nhật công cụ dòng lệnh này; tài khoản và cài đặt riêng của nó vẫn giữ nguyên.",
  gateNoUpgrade: "Chưa có phiên bản mới hơn để nâng cấp. Hiện tại, hãy chọn mô hình trong danh sách của phiên.",
  upgradeTo: (version: string) => `Nâng cấp lên ${version}`,
  updateStrip: (latest: string, current: string) => `Phiên bản ${latest} đã có (hiện tại: ${current}). Bạn có thể tiếp tục dùng mà không nâng cấp.`,
  viewUpgrade: "Xem cách nâng cấp",
  cancel: "Hủy",

  defaultModel: "Mô hình mặc định",
  defaultModelDesc:
    "Phiên mới bắt đầu bằng mô hình này; mỗi phiên vẫn có thể đổi bên dưới ô nhập. Mức “Đề xuất” đủ để chép lời, dịch và chỉnh sửa; bạn không cần mô hình mạnh nhất.",
  defaultModelOf: (name: string) => `Mô hình mặc định của ${name}`,
  defaultEffortOf: (name: string) => `Mức suy luận mặc định của ${name}`,
  modelsOf: (name: string, count: number) => `Mô hình của ${name} · ${count}`,
  modelsList: (list: string) => `${list}. Làm mới sau mỗi lần kiểm tra.`,
  modelsNone: "Agent không báo danh sách mô hình, nên phiên dùng mô hình mặc định của Agent. Sẽ hỏi lại khi kiểm tra lần tới.",
  refreshing: "Đang làm mới…",
  refreshModels: "Làm mới mô hình",
  refreshed: (name: string) => `Đã làm mới danh sách mô hình của ${name}`,
  nowDefault: (name: string) => `Phiên mới hiện dùng ${name}`,
  version: (version: string | null) => (version ? `Phiên bản · v${version}` : "Phiên bản"),
  versionDesc: (latest: string | null, min: string | null, source: string) =>
    `${latest ? `Bạn có thể nâng cấp lên ${latest}. ` : ""}${min ? `BaoCut cần ít nhất ${min}. ` : ""}Nâng cấp chỉ cập nhật công cụ dòng lệnh này; tài khoản và cài đặt riêng của nó vẫn giữ nguyên. ${source}`,
  account: "Tài khoản",
  accountDesc: (signedOut: boolean, account: string | null, plan: string) =>
    `${signedOut ? "Chưa đăng nhập hoặc đăng nhập đã hết hạn" : (account ?? "Đã đăng nhập")}. Dùng ${plan} của bạn; BaoCut không thu thêm phí. Đăng nhập trong terminal.`,
  loginInTerminal: "Mở terminal để đăng nhập",
  switchAccount: "Đổi tài khoản…",
  location: "Vị trí cài đặt",
  locationDesc: "BaoCut gọi trực tiếp chương trình này trên máy tính của bạn và không cài thêm bản sao.",
  realLocation: "Vị trí thực tế",
  setLocation: "Đặt vị trí thủ công",
  troubleshoot: "Khắc phục sự cố",
  troubleshootDesc: "Kiểm tra lần lượt cài đặt, phiên bản, đăng nhập và danh sách mô hình, rồi cho biết nơi gặp vướng mắc.",
  setDefault: "Đặt làm mặc định",
  runChecks: "Chạy kiểm tra",

  /** 升级说明的最后一句：认出了来源就点名，否则请用户用当初的方式。 */
  sourceKnown: (label: string) =>
    `Bản này được cài bằng “${label}”, nên hãy nâng cấp theo cùng cách. Các cách khác không cập nhật được bản này; chúng chỉ cài thêm bản khác.`,
  sourceUnknown: "Nâng cấp theo cách bạn đã cài.",
  scriptInstall:
    "Lệnh này tải xuống và chạy tập lệnh từ trang web chính thức. BaoCut không chạy tập lệnh trên internet thay bạn: hãy sao chép và tự chạy trong terminal.",
  scriptUpgrade: "Lệnh này tải xuống và chạy tập lệnh từ trang web chính thức. Hãy sao chép và tự chạy trong terminal.",
  copyUpgrade: "Sao chép lệnh này và chạy trong terminal, rồi quay lại đây để kiểm tra lại.",
  runnableHint: "Nhấp ▶ bên trái lệnh để chạy tại đây; đầu ra xuất hiện bên dưới. Hoặc sao chép và tự chạy trong terminal.",
  copyHint: "Sao chép lệnh bên dưới và chạy trong terminal.",
  installMethod: "Cách cài đặt",
  upgradeMethod: "Cách nâng cấp",
  needs: (needs: string) => `Cần ${needs} trên máy tính này.`,

  installIntro: (name: string, plan: string) =>
    `${name} là trợ lý AI dòng lệnh được cài trên máy tính của bạn, đăng nhập bằng ${plan} mà bạn đã có. BaoCut chỉ gọi nó: không thu thêm phí và không cần nhập khóa API trong BaoCut.`,
  stepInstall: "Cài trên máy tính này",
  stepInstallOfficial: "Cài trên máy tính này theo hướng dẫn chính thức",
  /** `command` 是排成代码样式的命令名。 */
  installOfficialBody: (command: ReactNode): ReactNode =>
    createElement(Fragment, null, "Cài theo hướng dẫn chính thức. Sau khi cài, ", command, " phải chạy được trong terminal."),
  stepLogin: "Đăng nhập tài khoản của bạn",
  stepLoginBody:
    "Sau khi cài, chạy lệnh bên dưới trong terminal và đăng nhập trong trình duyệt khi được yêu cầu. Đăng nhập diễn ra trong cửa sổ riêng của nó; BaoCut không xử lý tài khoản hay mật khẩu của bạn.",
  stepBack: "Quay lại đây",
  stepBackBody: "Có thể dùng ngay khi phát hiện đã cài và đã đăng nhập.",
  detecting: "Đang kiểm tra…",
  recheck: "Tôi đã cài, kiểm tra lại",
  notDetected: "Đã cài nhưng không phát hiện?",
  notDetectedBody:
    "BaoCut tìm trong PATH và các vị trí cài đặt phổ biến (Homebrew, thư mục toàn cục của npm, ~/.local/bin). Chương trình cài bằng trình quản lý phiên bản (nvm, asdf, mise) đôi khi nằm nơi khác; bạn có thể chỉ vị trí thủ công cho BaoCut.",
  diagnosisOf: (name: string) => `Kết quả kiểm tra cho ${name}`,
};
