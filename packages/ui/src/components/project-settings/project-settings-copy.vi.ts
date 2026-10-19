import type { ProjectSettingsMessages } from './project-settings-copy.ts';

export const vi: ProjectSettingsMessages = {
  menuItem: 'Cài đặt dự án…',
  title: 'Cài đặt dự án',
  close: 'Đóng cài đặt dự án',
  done: 'Xong',
  loading: 'Đang kiểm tra git',
  loadFailed: (message: string) => `Không kiểm tra được git: ${message}`,

  gitHeading: 'git',
  gitLead:
    'BaoCut có thể commit ảnh chụp không gian làm việc của các video vào kho git chứa dự án. Lịch sử phiên bản không cần git và vẫn hoạt động như thường khi không nằm trong kho.',
  branch: (name: string) => `Nhánh ${name}`,
  gitVersion: (version: string) => `git ${version}`,
  checkAgain: 'Kiểm tra lại',
  sentences: (first: string, second: string | null) => (second ? `${first}. ${second}.` : `${first}.`),

  lightReady: 'Sẵn sàng',
  lightPaused: (label: string) => `Đã tạm dừng · ${label}`,
  lightNotRepo: 'Không nằm trong kho git',
  lightUnavailable: 'Không tìm thấy git',
  lightError: 'git gặp lỗi',
  pauseLocked: 'Kho đang được sử dụng',
  pauseMerge: 'Đang merge',
  pauseRebase: 'Đang rebase',
  pauseCherryPick: 'Đang cherry-pick',
  pauseRevert: 'Đang revert',
  pauseBisect: 'Đang bisect',
  pauseDetached: 'HEAD tách rời',
  pauseLocalConfig: 'Có bộ lọc cục bộ',
  pauseLocalConfigChanged: 'Bộ lọc cục bộ đã thay đổi',

  pausedHeading: (label: string) => `Đã tạm dừng commit: ${label}`,
  pausedNote: 'Trong lúc tạm dừng commit, tự động commit và “Commit vào git” đều chờ. Mở, chỉnh sửa và lịch sử phiên bản không bị ảnh hưởng.',
  errorHeading: 'git gặp lỗi',
  unavailableHeading: 'Không tìm thấy git',

  lcEntry: 'Mục',
  lcValue: 'Lệnh hoặc tệp được nạp',
  lcExplain:
    'Sau khi bạn cho phép, BaoCut làm theo các mục này khi chạy git (ví dụ mã hóa git-crypt). Quyền này chỉ được lưu trên máy tính này, không lưu vào dự án, và BaoCut sẽ tạm dừng lại nếu các mục hoặc các tệp được nạp thay đổi. Đây không phải là tin cậy thư mục: mở, chỉnh sửa và Agent không bị ảnh hưởng.',
  lcWeb:
    'Các mục này chỉ được liệt kê, và chỉ có thể cho phép, trong cài đặt dự án của ứng dụng BaoCut trên máy tính (hoặc bằng baocut projects git-allow). Trong lúc tạm dừng commit, mở, chỉnh sửa và lịch sử phiên bản không bị ảnh hưởng.',
  allow: 'Cho phép',
  allowedTitle: 'Đã cho phép bộ lọc cục bộ',
  allowedText: 'Quyền được lưu trên máy tính này, không lưu vào dự án. Giờ bạn có thể commit.',
  allowFailed: 'Chưa cho phép',

  commit: 'Commit vào git',
  committing: 'Đang commit',
  commitDesc: (maxMiB: number) =>
    `Chỉ commit các tệp của BaoCut: ảnh chụp không gian làm việc của các video có thay đổi và tư liệu không quá ${maxMiB} MiB. Các tệp khác trong dự án và các thay đổi bạn đã stage vẫn giữ nguyên. BaoCut không push.`,
  lastCommit: (commit: string, auto: boolean, ago: string) => `Commit gần nhất ${commit} · ${auto ? 'tự động' : 'thủ công'} · ${ago}`,
  lastFailed: (message: string) => `Lần thử gần nhất thất bại: ${message}`,
  committedTitle: 'Đã commit vào git',
  committedText: (commit: string, files: number, videos: string[]) =>
    `Đã commit ${commit}: ${files} tệp${videos.length ? `, ${videos.join(', ')}` : ''}.`,
  committedVideo: (name: string, from: number | null, to: number | null) =>
    from === null || to === null ? `“${name}”` : from === to ? `“${name}” phiên bản ${to}` : `“${name}” phiên bản ${from}–${to}`,
  unnamedVideo: 'một video',
  nothingTitle: 'Không có gì để commit',
  nothingText: 'Các tệp của BaoCut giống như lúc commit gần nhất.',
  commitFailed: 'Chưa commit',

  autoCommit: 'Tự động commit',
  autoCommitDesc:
    'Commit một lần sau khi dự án không có thay đổi trong 5 phút, khi bạn đóng video cuối cùng đang mở của dự án hoặc khi thoát BaoCut. Mọi dự án trên máy tính này dùng chung cài đặt này.',

  initTitle: 'Khởi tạo git',
  initDesc: 'Tạo kho git trong thư mục dự án để có thể commit ảnh chụp vào đó.',
  initWebNote: 'Chỉ ứng dụng BaoCut trên máy tính hoặc CLI (baocut projects git-init) mới có thể tạo kho trong một thư mục trên máy tính chạy Runtime.',
  initRefused: (why: string) => `Không khả dụng ở đây: ${why}`,
  initRefusedNote: 'Nếu cần, hãy chuyển các video vào một thư mục dự án riêng rồi khởi tạo git ở đó.',
  refusalHome:
    'dự án là thư mục chính của bạn. Nếu tạo kho ở đây, với các công cụ khác, mọi thư mục trong thư mục chính sẽ trông như thuộc kho này.',
  refusalUserFolder:
    'dự án là một thư mục người dùng tiêu chuẩn (như Màn hình nền, Tài liệu, Tải về, Phim, Nhạc hoặc Hình ảnh). Nếu tạo kho ở đây, với các công cụ khác, mọi thư mục bên trong sẽ trông như thuộc kho này.',
  refusalVolumeRoot: 'dự án là thư mục gốc của một ổ đĩa. Nếu tạo kho ở đây, cả ổ đĩa sẽ trông như thuộc kho này.',
  refusalInsideRepo: 'dự án đã nằm trong một kho git.',
  initConfirmTitle: 'Khởi tạo git trong thư mục dự án?',
  initConfirmBody: (path: string) =>
    `Tạo một kho git trong ${path}. Quy tắc bỏ qua của BaoCut được ghi vào .git/info/ riêng của kho, nên không tệp nào trong dự án thay đổi. Không commit hay push gì cả.`,
  cancel: 'Hủy',
  initDoneTitle: 'Đã khởi tạo git',
  initDoneText: 'Chưa có commit nào. Dùng “Commit vào git” để tạo commit đầu tiên.',
  initFailed: 'Chưa khởi tạo',

  recheckSame: 'Không có gì thay đổi',
  recheckReadyTitle: 'Sẵn sàng commit',
  recheckReadyText: 'Kho không còn bị tạm dừng.',

  outsideHeading: 'Tư liệu ngoài dự án',
  outsideLead:
    'Khi video dùng tư liệu nằm ngoài thư mục dự án, ảnh chụp không gian làm việc ghi lại đường dẫn của tư liệu (bắt đầu bằng ~/ nếu nằm trong thư mục chính, nếu không thì ghi đường dẫn đầy đủ). Sau khi commit hoặc push, người khác chỉ nhận được đường dẫn, không có tệp. Để giao cả tư liệu, hãy dùng gói di động.',

  stripLabel: 'git của dự án',
  projectSettings: 'Cài đặt dự án',
};
